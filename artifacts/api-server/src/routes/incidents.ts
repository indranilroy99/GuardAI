/**
 * Incidents Timeline Route
 *
 * POST /api/incidents/timeline
 *   Takes a list of correlated alert IDs and returns a structured kill-chain
 *   timeline plus an AI-generated analyst narrative.
 */

import { Router } from "express";
import { db, alertsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const AI_PROVIDER = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
const AI_MODEL =
  AI_PROVIDER === "openrouter"
    ? (process.env.AI_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free")
    : (process.env.AI_MODEL ?? "gpt-4o");

function getClient() {
  return AI_PROVIDER === "openrouter" ? openrouter : openai;
}

// MITRE ATT&CK tactic order (kill chain progression)
const PHASE_ORDER = [
  "Reconnaissance",
  "Resource Development",
  "Initial Access",
  "Execution",
  "Persistence",
  "Privilege Escalation",
  "Defense Evasion",
  "Credential Access",
  "Discovery",
  "Lateral Movement",
  "Collection",
  "Command and Control",
  "Exfiltration",
  "Impact",
];

function phaseIndex(tactic: string): number {
  const idx = PHASE_ORDER.findIndex(
    (p) => p.toLowerCase() === tactic.toLowerCase()
  );
  return idx >= 0 ? idx : 99;
}

router.post("/incidents/timeline", async (req, res) => {
  const { alertIds } = req.body as { alertIds?: number[] };

  if (!Array.isArray(alertIds) || alertIds.length === 0) {
    res.status(400).json({ error: "alertIds must be a non-empty array" });
    return;
  }

  if (alertIds.length > 100) {
    res.status(400).json({ error: "Maximum 100 alerts per timeline request" });
    return;
  }

  try {
    // Fetch all alerts for this incident
    const alerts = await db
      .select()
      .from(alertsTable)
      .where(inArray(alertsTable.id, alertIds));

    if (alerts.length === 0) {
      res.status(404).json({ error: "No alerts found for given IDs" });
      return;
    }

    // Sort by time then by kill-chain phase
    const sorted = [...alerts].sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return phaseIndex(a.mitreAttackTactic) - phaseIndex(b.mitreAttackTactic);
    });

    // Group into timeline stages by MITRE tactic
    const stageMap = new Map<string, typeof alerts>();
    for (const alert of sorted) {
      if (!stageMap.has(alert.mitreAttackTactic)) {
        stageMap.set(alert.mitreAttackTactic, []);
      }
      stageMap.get(alert.mitreAttackTactic)!.push(alert);
    }

    // Order stages by kill-chain phase
    const stages = Array.from(stageMap.entries())
      .sort(([a], [b]) => phaseIndex(a) - phaseIndex(b))
      .map(([tactic, stageAlerts]) => ({
        tactic,
        phaseIndex: phaseIndex(tactic),
        alerts: stageAlerts,
        maxSeverity: stageAlerts.reduce((best, a) => {
          const order: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
          return (order[a.severity] ?? 0) > (order[best] ?? 0) ? a.severity : best;
        }, "LOW"),
      }));

    // Unique affected resources
    const resources = [...new Set(alerts.map((a) => a.affectedResource))].map(
      (resource) => ({
        resource,
        alerts: alerts.filter((a) => a.affectedResource === resource).length,
        topSeverity: alerts
          .filter((a) => a.affectedResource === resource)
          .reduce((best, a) => {
            const order: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
            return (order[a.severity] ?? 0) > (order[best] ?? 0) ? a.severity : best;
          }, "LOW"),
      })
    );

    // Build the AI narrative
    const alertSummary = sorted
      .slice(0, 20) // cap context length
      .map(
        (a) =>
          `[${new Date(a.createdAt).toISOString()}] ${a.severity} — ${a.mitreAttackTactic} / ${a.mitreAttackTechniqueId} — ${a.title} — Resource: ${a.affectedResource} — Account: ${a.accountId}`
      )
      .join("\n");

    const prompt = `You are a senior threat intelligence analyst at a world-class SOC. Below are correlated GuardDuty alerts forming a single security incident, ordered by time:

${alertSummary}

Analyze this incident and respond ONLY with valid JSON (no markdown, no code fences) matching exactly this schema:
{
  "headline": "One-sentence incident title (max 80 chars)",
  "attackerProfile": "Opportunistic" | "Targeted" | "Advanced Persistent Threat",
  "objective": "Likely attacker goal in 6 words or fewer",
  "currentPhase": "Most advanced MITRE tactic observed",
  "riskScore": integer 0-100,
  "narrative": "2-3 paragraph analyst narrative describing exactly what happened, in present tense, from the attacker perspective. Be specific about techniques, resources, and timeline.",
  "responseActions": ["Action 1", "Action 2", "Action 3", "Action 4"]
}`;

    let narrativeRaw = "";
    try {
      const client = getClient();
      const completion = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 900,
        temperature: 0.3,
      });
      narrativeRaw = completion.choices[0]?.message?.content?.trim() ?? "";
    } catch (aiErr) {
      req.log.warn({ aiErr }, "AI narrative generation failed — returning structure without narrative");
    }

    // Parse AI JSON — strip any accidental markdown fences
    let narrative: {
      headline: string;
      attackerProfile: string;
      objective: string;
      currentPhase: string;
      riskScore: number;
      narrative: string;
      responseActions: string[];
    } | null = null;

    if (narrativeRaw) {
      try {
        const clean = narrativeRaw.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
        narrative = JSON.parse(clean) as typeof narrative;
      } catch {
        req.log.warn("Failed to parse AI narrative JSON");
      }
    }

    res.json({
      alerts: sorted,
      stages,
      resources,
      narrative,
      meta: {
        totalAlerts: alerts.length,
        firstSeen: sorted[0]?.createdAt ?? null,
        lastSeen: sorted[sorted.length - 1]?.createdAt ?? null,
        uniqueTactics: stageMap.size,
        uniqueResources: resources.length,
        accounts: [...new Set(alerts.map((a) => a.accountId))],
        regions: [...new Set(alerts.map((a) => a.region))],
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build incident timeline");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

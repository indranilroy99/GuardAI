/**
 * False Positive Learning Engine
 *
 * GET  /api/fp-engine/patterns         — extract FP patterns from verdict history
 * POST /api/fp-engine/suggest          — score one alert against FP history
 * GET  /api/fp-engine/auto-suspect     — score all unverdicited alerts, return those above threshold
 * POST /api/fp-engine/bulk-verdict     — bulk-apply a verdict to a list of alert IDs
 */

import { Router } from "express";
import { db, alertsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { recordActivity } from "../lib/record-activity.js";

const router = Router();

// ─── Shared types ─────────────────────────────────────────────────────────────

type DbAlert = typeof alertsTable.$inferSelect;

type FpArtifact = {
  id: number;
  title: string;
  affectedResource: string;
  accountId: string;
  region: string;
  resourceType: string;
  markedAt: string;
};

// ─── Shared scoring helper ────────────────────────────────────────────────────

type ScoredMatch = { alert: DbAlert; score: number; reasons: string[] };

function scoreAlert(
  target: Pick<DbAlert, "type" | "mitreAttackTechniqueId" | "accountId" | "resourceType" | "affectedResource">,
  fpAlerts: DbAlert[],
  excludeId = -1
): ScoredMatch[] {
  const scored: ScoredMatch[] = [];
  for (const fp of fpAlerts) {
    if (fp.id === excludeId) continue;
    let score = 0;
    const reasons: string[] = [];

    if (fp.type === target.type) {
      score += 40;
      reasons.push(`Same finding type (${fp.type})`);
    }
    if (fp.mitreAttackTechniqueId === target.mitreAttackTechniqueId) {
      score += 25;
      reasons.push(`Same MITRE technique (${fp.mitreAttackTechniqueId})`);
    }
    if (fp.accountId === target.accountId) {
      score += 15;
      reasons.push(`Same AWS account (${fp.accountId})`);
    }
    if (fp.resourceType === target.resourceType) {
      score += 10;
      reasons.push(`Same resource type (${fp.resourceType})`);
    }
    if (fp.affectedResource === target.affectedResource) {
      score += 20;
      reasons.push(`Exact same resource (${fp.affectedResource})`);
    }

    if (score >= 40) scored.push({ alert: fp, score, reasons });
  }
  return scored;
}

function collapseToPatternsWithScore(
  scored: ScoredMatch[],
  tpAlerts: DbAlert[]
): { score: number; confidence: number; matchReasons: string[]; pattern: { type: string; technique: string; tactic: string; techniqueId: string }; artifacts: FpArtifact[] } | null {
  if (scored.length === 0) return null;

  const patternMap = new Map<string, ScoredMatch[]>();
  for (const s of scored) {
    const key = `${s.alert.type}::${s.alert.mitreAttackTechniqueId}`;
    if (!patternMap.has(key)) patternMap.set(key, []);
    patternMap.get(key)!.push(s);
  }

  let bestScore = 0;
  let best: { score: number; confidence: number; matchReasons: string[]; pattern: { type: string; technique: string; tactic: string; techniqueId: string }; artifacts: FpArtifact[] } | null = null;

  for (const [, group] of patternMap) {
    const sorted = group.sort((a, b) => b.score - a.score);
    const tpCount = tpAlerts.filter(
      (a) => a.type === sorted[0]!.alert.type && a.mitreAttackTechniqueId === sorted[0]!.alert.mitreAttackTechniqueId
    ).length;
    const fpCount = group.length;
    const confidence = Math.round((fpCount / (fpCount + tpCount)) * 100);
    const score = sorted[0]!.score;
    if (score > bestScore) {
      bestScore = score;
      best = {
        score,
        confidence,
        matchReasons: [...new Set(sorted[0]!.reasons)],
        pattern: {
          type: sorted[0]!.alert.type,
          technique: sorted[0]!.alert.mitreAttackTechnique,
          tactic: sorted[0]!.alert.mitreAttackTactic,
          techniqueId: sorted[0]!.alert.mitreAttackTechniqueId,
        },
        artifacts: sorted.slice(0, 5).map((s) => ({
          id: s.alert.id,
          title: s.alert.title,
          affectedResource: s.alert.affectedResource,
          accountId: s.alert.accountId,
          region: s.alert.region,
          resourceType: s.alert.resourceType,
          markedAt: s.alert.updatedAt?.toISOString() ?? s.alert.createdAt.toISOString(),
        })),
      };
    }
  }
  return best;
}

// ─── Pattern extraction ───────────────────────────────────────────────────────

type FpPattern = {
  key: string;
  type: string;
  mitreAttackTechniqueId: string;
  mitreAttackTechnique: string;
  mitreAttackTactic: string;
  frequency: number;
  accounts: string[];
  resourceTypes: string[];
  regions: string[];
  confidence: number;
  artifacts: FpArtifact[];
};

router.get("/fp-engine/patterns", async (req, res) => {
  try {
    const allAlerts = await db.select().from(alertsTable);
    const fpAlerts = allAlerts.filter((a) => a.verdict === "FALSE_POSITIVE");
    const tpAlerts = allAlerts.filter((a) => a.verdict === "TRUE_POSITIVE");

    const map = new Map<string, DbAlert[]>();
    for (const a of fpAlerts) {
      const key = `${a.type}::${a.mitreAttackTechniqueId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }

    const patterns: FpPattern[] = [];
    for (const [key, group] of map) {
      const [type, techniqueId] = key.split("::");
      const tpCount = tpAlerts.filter(
        (a) => a.type === type && a.mitreAttackTechniqueId === techniqueId
      ).length;
      const confidence = Math.round((group.length / (group.length + tpCount)) * 100);

      patterns.push({
        key,
        type: type ?? "",
        mitreAttackTechniqueId: techniqueId ?? "",
        mitreAttackTechnique: group[0]?.mitreAttackTechnique ?? "",
        mitreAttackTactic: group[0]?.mitreAttackTactic ?? "",
        frequency: group.length,
        accounts: [...new Set(group.map((a) => a.accountId))],
        resourceTypes: [...new Set(group.map((a) => a.resourceType))],
        regions: [...new Set(group.map((a) => a.region))],
        confidence,
        artifacts: group
          .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())
          .slice(0, 8)
          .map((a) => ({
            id: a.id,
            title: a.title,
            affectedResource: a.affectedResource,
            accountId: a.accountId,
            region: a.region,
            resourceType: a.resourceType,
            markedAt: a.updatedAt?.toISOString() ?? a.createdAt.toISOString(),
          })),
      });
    }

    patterns.sort((a, b) => b.confidence - a.confidence || b.frequency - a.frequency);

    res.json({
      patterns,
      summary: {
        totalFpAlerts: fpAlerts.length,
        totalTpAlerts: tpAlerts.length,
        uniquePatterns: patterns.length,
        topPattern: patterns[0] ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "fp-engine/patterns failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Per-alert suggestion ─────────────────────────────────────────────────────

router.post("/fp-engine/suggest", async (req, res) => {
  const body = req.body as Partial<{ type: string; mitreAttackTechniqueId: string; accountId: string; resourceType: string; affectedResource: string; excludeId: number }>;
  if (!body.type || !body.mitreAttackTechniqueId) {
    res.status(400).json({ error: "type and mitreAttackTechniqueId are required" });
    return;
  }

  try {
    const all = await db.select().from(alertsTable);
    const fpAlerts = all.filter((a) => a.verdict === "FALSE_POSITIVE");
    const tpAlerts = all.filter((a) => a.verdict === "TRUE_POSITIVE");

    const scored = scoreAlert(
      { type: body.type, mitreAttackTechniqueId: body.mitreAttackTechniqueId, accountId: body.accountId ?? "", resourceType: (body.resourceType ?? "") as DbAlert["resourceType"], affectedResource: body.affectedResource ?? "" },
      fpAlerts,
      body.excludeId
    );

    const patternMap = new Map<string, ScoredMatch[]>();
    for (const s of scored) {
      const key = `${s.alert.type}::${s.alert.mitreAttackTechniqueId}`;
      if (!patternMap.has(key)) patternMap.set(key, []);
      patternMap.get(key)!.push(s);
    }

    const suggestions = [];
    for (const [, group] of patternMap) {
      const best = group.sort((a, b) => b.score - a.score);
      const tpCount = tpAlerts.filter(
        (a) => a.type === best[0]!.alert.type && a.mitreAttackTechniqueId === best[0]!.alert.mitreAttackTechniqueId
      ).length;
      const fpCount = group.length;
      suggestions.push({
        score: best[0]!.score,
        confidence: Math.round((fpCount / (fpCount + tpCount)) * 100),
        matchReasons: [...new Set(best[0]!.reasons)],
        pattern: {
          type: best[0]!.alert.type,
          technique: best[0]!.alert.mitreAttackTechnique,
          tactic: best[0]!.alert.mitreAttackTactic,
          techniqueId: best[0]!.alert.mitreAttackTechniqueId,
        },
        artifacts: best.slice(0, 5).map((s) => ({
          id: s.alert.id,
          title: s.alert.title,
          affectedResource: s.alert.affectedResource,
          accountId: s.alert.accountId,
          region: s.alert.region,
          resourceType: s.alert.resourceType,
          markedAt: s.alert.updatedAt?.toISOString() ?? s.alert.createdAt.toISOString(),
        })),
      });
    }

    suggestions.sort((a, b) => b.score - a.score);
    res.json({ suggestions, totalFpHistory: fpAlerts.length });
  } catch (err) {
    req.log.error({ err }, "fp-engine/suggest failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Auto-suspect: scan all open alerts ──────────────────────────────────────

type SuspectedAlert = {
  id: number;
  title: string;
  severity: string;
  type: string;
  affectedResource: string;
  accountId: string;
  region: string;
  resourceType: string;
  createdAt: string;
  score: number;
  confidence: number;
  matchReasons: string[];
  topPattern: { type: string; technique: string; tactic: string; techniqueId: string };
  evidence: FpArtifact[];
};

router.get("/fp-engine/auto-suspect", async (req, res) => {
  const threshold = Math.max(40, Math.min(100, parseInt(String(req.query["threshold"] ?? "80"), 10) || 80));

  try {
    const all = await db.select().from(alertsTable);
    const fpAlerts = all.filter((a) => a.verdict === "FALSE_POSITIVE");
    const tpAlerts = all.filter((a) => a.verdict === "TRUE_POSITIVE");
    // Candidates: open alerts with no verdict yet
    const candidates = all.filter((a) => !a.verdict);

    if (fpAlerts.length === 0) {
      res.json({ suspects: [], threshold, totalCandidates: candidates.length, fpHistorySize: 0 });
      return;
    }

    const suspects: SuspectedAlert[] = [];

    for (const candidate of candidates) {
      const scored = scoreAlert(candidate, fpAlerts);
      const best = collapseToPatternsWithScore(scored, tpAlerts);
      if (!best || best.score < threshold) continue;

      suspects.push({
        id: candidate.id,
        title: candidate.title,
        severity: candidate.severity,
        type: candidate.type,
        affectedResource: candidate.affectedResource,
        accountId: candidate.accountId,
        region: candidate.region,
        resourceType: candidate.resourceType,
        createdAt: candidate.createdAt.toISOString(),
        score: best.score,
        confidence: best.confidence,
        matchReasons: best.matchReasons,
        topPattern: best.pattern,
        evidence: best.artifacts,
      });
    }

    // Sort by score desc, then severity
    const SEV_ORDER: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    suspects.sort((a, b) => b.score - a.score || (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));

    res.json({
      suspects,
      threshold,
      totalCandidates: candidates.length,
      fpHistorySize: fpAlerts.length,
    });
  } catch (err) {
    req.log.error({ err }, "fp-engine/auto-suspect failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Bulk verdict ─────────────────────────────────────────────────────────────

router.post("/fp-engine/bulk-verdict", async (req, res) => {
  const body = req.body as Partial<{ alertIds: number[]; verdict: string }>;
  if (!Array.isArray(body.alertIds) || body.alertIds.length === 0) {
    res.status(400).json({ error: "alertIds must be a non-empty array" });
    return;
  }
  if (body.verdict !== "FALSE_POSITIVE" && body.verdict !== "TRUE_POSITIVE") {
    res.status(400).json({ error: "verdict must be FALSE_POSITIVE or TRUE_POSITIVE" });
    return;
  }

  try {
    const updated = await db
      .update(alertsTable)
      .set({ verdict: body.verdict, updatedAt: new Date() })
      .where(inArray(alertsTable.id, body.alertIds))
      .returning({ id: alertsTable.id, title: alertsTable.title });

    res.json({ updated: updated.length, alertIds: updated.map((a) => a.id) });

    // Record activity for each affected alert so watchers are notified
    const actorId = (req as any).auth?.userId ?? "system";
    const actorName = (req as any).auth?.username ?? "FP Engine";
    const label = body.verdict === "FALSE_POSITIVE" ? "False Positive" : "True Positive";
    for (const row of updated) {
      void recordActivity(
        row.id,
        row.title,
        "verdict_changed",
        `Verdict set to ${label} by FP Engine`,
        actorId,
        actorName,
      );
    }
  } catch (err) {
    req.log.error({ err }, "fp-engine/bulk-verdict failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

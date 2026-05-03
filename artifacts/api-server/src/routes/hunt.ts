/**
 * Threat Hunt Route
 *
 * POST /api/hunt
 *   Natural-language threat hunt. The AI interprets the query into structured
 *   filters, applies them against the alerts DB, then generates a narrative
 *   intelligence summary of the matched findings.
 */

import { Router } from "express";
import { db, alertsTable } from "@workspace/db";
import { desc, and, gte, ilike, inArray, or, eq } from "drizzle-orm";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const AI_PROVIDER = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
const AI_MODEL = process.env.AI_MODEL ?? (
  AI_PROVIDER === "openrouter" ? "meta-llama/llama-3.3-70b-instruct:free" : "gpt-4o"
);

function getClient() {
  return AI_PROVIDER === "openrouter" ? openrouter : openai;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface HuntFilters {
  timeRange: "1h" | "24h" | "7d" | "30d" | "all";
  severities: Array<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">;
  mitreTactics: string[];
  resourceTypes: Array<"IAM_ROLE" | "EC2_INSTANCE" | "S3_BUCKET" | "OTHER">;
  keywords: string[];
  accountId: string | null;
  verdictFilter: "TRUE_POSITIVE" | "FALSE_POSITIVE" | "NEEDS_REVIEW" | null;
  triageFilter: "complete" | "running" | "idle" | null;
  interpretation: string;
  huntTitle: string;
}

// ─── AI Query Interpreter ────────────────────────────────────────────────────

async function interpretQuery(query: string): Promise<HuntFilters> {
  const client = getClient();
  const useJsonMode = AI_PROVIDER !== "openrouter";

  const prompt = `You are a senior threat analyst. Parse this threat hunt query into structured search filters.

Query: "${query}"

Available values:
- timeRange: "1h" | "24h" | "7d" | "30d" | "all"
- severities: array of "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" (empty = all)
- mitreTactics: MITRE ATT&CK tactic names to match (e.g. "Lateral Movement", "Privilege Escalation", "Defense Evasion", "Credential Access", "Discovery", "Collection", "Exfiltration", "Command and Control", "Persistence", "Initial Access", "Execution", "Impact")
- resourceTypes: array of "IAM_ROLE" | "EC2_INSTANCE" | "S3_BUCKET" | "OTHER" (empty = all)
- keywords: important search terms to match in alert title, type, or description
- accountId: specific AWS account ID if mentioned, null otherwise
- verdictFilter: "TRUE_POSITIVE" | "FALSE_POSITIVE" | "NEEDS_REVIEW" | null
- triageFilter: "complete" | "running" | "idle" | null
- interpretation: one sentence describing what the hunt is looking for
- huntTitle: short 3-5 word title for this hunt

Respond with JSON only:
{
  "timeRange": "7d",
  "severities": ["HIGH", "CRITICAL"],
  "mitreTactics": ["Lateral Movement"],
  "resourceTypes": [],
  "keywords": ["suspicious", "port scan"],
  "accountId": null,
  "verdictFilter": null,
  "triageFilter": null,
  "interpretation": "Hunting for lateral movement activity in the last 7 days with high or critical severity",
  "huntTitle": "Lateral Movement Hunt"
}`;

  const resp = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 500,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      ...(useJsonMode ? [] : [{ role: "system" as const, content: "Respond with valid JSON only. No markdown or explanation." }]),
      { role: "user" as const, content: prompt },
    ],
  });

  let content = resp.choices[0]?.message?.content ?? "{}";
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const parsed = JSON.parse(content) as Partial<HuntFilters>;
  return {
    timeRange: parsed.timeRange ?? "7d",
    severities: parsed.severities ?? [],
    mitreTactics: parsed.mitreTactics ?? [],
    resourceTypes: parsed.resourceTypes ?? [],
    keywords: parsed.keywords ?? [],
    accountId: parsed.accountId ?? null,
    verdictFilter: parsed.verdictFilter ?? null,
    triageFilter: parsed.triageFilter ?? null,
    interpretation: parsed.interpretation ?? query,
    huntTitle: parsed.huntTitle ?? "Threat Hunt",
  };
}

// ─── DB Query Builder ────────────────────────────────────────────────────────

function timeRangeToDate(range: string): Date | null {
  const now = new Date();
  switch (range) {
    case "1h":  return new Date(now.getTime() - 3600 * 1000);
    case "24h": return new Date(now.getTime() - 86400 * 1000);
    case "7d":  return new Date(now.getTime() - 7 * 86400 * 1000);
    case "30d": return new Date(now.getTime() - 30 * 86400 * 1000);
    default:    return null;
  }
}

type AlertRow = typeof alertsTable.$inferSelect;

async function runHuntQuery(filters: HuntFilters): Promise<AlertRow[]> {
  const conditions = [];

  // Time range
  const since = timeRangeToDate(filters.timeRange);
  if (since) conditions.push(gte(alertsTable.createdAt, since));

  // Severities
  if (filters.severities.length > 0) {
    conditions.push(inArray(alertsTable.severity, filters.severities));
  }

  // MITRE tactics
  if (filters.mitreTactics.length > 0) {
    const tacticConds = filters.mitreTactics.map((t) =>
      ilike(alertsTable.mitreAttackTactic, `%${t}%`)
    );
    conditions.push(or(...tacticConds)!);
  }

  // Resource types
  if (filters.resourceTypes.length > 0) {
    conditions.push(inArray(alertsTable.resourceType, filters.resourceTypes));
  }

  // Account
  if (filters.accountId) {
    conditions.push(eq(alertsTable.accountId, filters.accountId));
  }

  // Verdict
  if (filters.verdictFilter) {
    conditions.push(ilike(alertsTable.verdict ?? alertsTable.verdict, `%${filters.verdictFilter}%`));
  }

  // Triage status
  if (filters.triageFilter) {
    conditions.push(eq(alertsTable.triageStatus, filters.triageFilter));
  }

  // Keyword search (across title, type, description)
  if (filters.keywords.length > 0) {
    const kwConds = filters.keywords.flatMap((kw) => [
      ilike(alertsTable.title, `%${kw}%`),
      ilike(alertsTable.type, `%${kw}%`),
      ilike(alertsTable.description, `%${kw}%`),
      ilike(alertsTable.mitreAttackTechnique, `%${kw}%`),
    ]);
    conditions.push(or(...kwConds)!);
  }

  return db
    .select()
    .from(alertsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alertsTable.createdAt))
    .limit(50);
}

// ─── AI Hunt Summary ─────────────────────────────────────────────────────────

async function generateHuntSummary(
  query: string,
  filters: HuntFilters,
  results: AlertRow[],
): Promise<string> {
  if (results.length === 0) {
    return `No findings matched the hunt query "${query}". This may indicate the environment is clean for this threat pattern, or the time range/filters are too narrow.`;
  }

  const client = getClient();
  const useJsonMode = AI_PROVIDER !== "openrouter";

  const alertSummary = results.slice(0, 15).map((a) => ({
    id: a.id,
    title: a.title,
    severity: a.severity,
    tactic: a.mitreAttackTactic,
    technique: a.mitreAttackTechnique,
    resource: a.affectedResource,
    accountId: a.accountId,
    region: a.region,
    verdict: a.verdict ?? "not triaged",
    createdAt: a.createdAt.toISOString(),
  }));

  const sevCounts = results.reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  const prompt = `You are a senior threat intelligence analyst writing a hunt report.

Hunt Query: "${query}"
Hunt Interpretation: ${filters.interpretation}
Time Range: ${filters.timeRange}
Total Findings: ${results.length}
Severity Breakdown: ${JSON.stringify(sevCounts)}

Top Findings (up to 15):
${JSON.stringify(alertSummary, null, 2)}

Write a concise, professional threat hunt summary (3-5 paragraphs). Cover:
1. What was found and whether it represents a real threat pattern
2. The most significant findings and what they indicate
3. Accounts or resources most affected
4. MITRE ATT&CK patterns observed
5. Recommended immediate actions

Be specific and actionable. Reference actual alert titles and IDs.`;

  const resp = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 800,
    ...(useJsonMode ? {} : {}),
    messages: [
      { role: "system" as const, content: "You are a senior SOC analyst. Write clear, concise threat intelligence reports." },
      { role: "user" as const, content: prompt },
    ],
  });

  return resp.choices[0]?.message?.content ?? "Unable to generate hunt summary.";
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post("/hunt", async (req, res) => {
  const { query } = req.body as { query?: string };

  if (!query || typeof query !== "string" || query.trim().length < 3) {
    res.status(400).json({ error: "query must be at least 3 characters" });
    return;
  }

  const trimmed = query.trim();

  try {
    // 1. Interpret the NL query into structured filters
    const filters = await interpretQuery(trimmed);

    // 2. Run the DB query
    const results = await runHuntQuery(filters);

    // 3. Generate AI narrative summary
    const summary = await generateHuntSummary(trimmed, filters, results);

    // 4. Serialize dates and return
    res.json({
      query: trimmed,
      filters,
      results: results.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      summary,
      totalFound: results.length,
      searchedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Hunt query failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Hunt query failed" });
  }
});

export default router;

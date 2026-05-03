/**
 * Hunt Scheduler
 *
 * Background job that runs scheduled threat hunts and creates
 * in-app notifications (and optional webhook calls) when new findings appear.
 */

import { db, scheduledHuntsTable, huntNotificationsTable, alertsTable } from "@workspace/db";
import { eq, and, gte, ilike, inArray, or, lte, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { openai } from "@workspace/integrations-openai-ai-server";

const AI_PROVIDER = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
const AI_MODEL = process.env.AI_MODEL ?? (
  AI_PROVIDER === "openrouter" ? "meta-llama/llama-3.3-70b-instruct:free" : "gpt-4o"
);

function getClient() {
  return AI_PROVIDER === "openrouter" ? openrouter : openai;
}

// ─── Schedule Math ────────────────────────────────────────────────────────────

function getNextRunAt(schedule: string): Date {
  const now = new Date();
  switch (schedule) {
    case "hourly":  return new Date(now.getTime() + 3600_000);
    case "weekly":  return new Date(now.getTime() + 7 * 86_400_000);
    case "daily":
    default:        return new Date(now.getTime() + 86_400_000);
  }
}

// ─── NL Query Interpreter (inline, no HTTP round-trip) ────────────────────────

interface HuntFilters {
  timeRange: string;
  severities: string[];
  mitreTactics: string[];
  resourceTypes: string[];
  keywords: string[];
  accountId: string | null;
  verdictFilter: string | null;
  triageFilter: string | null;
}

async function interpretQuery(query: string): Promise<HuntFilters> {
  const client = getClient();
  const useJsonMode = AI_PROVIDER !== "openrouter";

  const prompt = `Parse this threat hunt query into JSON filters.
Query: "${query}"
Available: timeRange("1h"|"24h"|"7d"|"30d"|"all"), severities(array of "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"), mitreTactics(array), resourceTypes(array of "IAM_ROLE"|"EC2_INSTANCE"|"S3_BUCKET"|"OTHER"), keywords(array), accountId(string|null), verdictFilter(string|null), triageFilter(string|null).
Respond with JSON only.`;

  const resp = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 300,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      ...(useJsonMode ? [] : [{ role: "system" as const, content: "Respond with valid JSON only." }]),
      { role: "user" as const, content: prompt },
    ],
  });

  let content = resp.choices[0]?.message?.content ?? "{}";
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(content) as Partial<HuntFilters>;

  return {
    timeRange: parsed.timeRange ?? "24h",
    severities: parsed.severities ?? [],
    mitreTactics: parsed.mitreTactics ?? [],
    resourceTypes: parsed.resourceTypes ?? [],
    keywords: parsed.keywords ?? [],
    accountId: parsed.accountId ?? null,
    verdictFilter: parsed.verdictFilter ?? null,
    triageFilter: parsed.triageFilter ?? null,
  };
}

function timeRangeToDate(range: string): Date | null {
  const now = new Date();
  switch (range) {
    case "1h":  return new Date(now.getTime() - 3_600_000);
    case "24h": return new Date(now.getTime() - 86_400_000);
    case "7d":  return new Date(now.getTime() - 7 * 86_400_000);
    case "30d": return new Date(now.getTime() - 30 * 86_400_000);
    default:    return null;
  }
}

type AlertRow = typeof alertsTable.$inferSelect;

async function runQuery(filters: HuntFilters): Promise<AlertRow[]> {
  const conditions = [];
  const since = timeRangeToDate(filters.timeRange);
  if (since) conditions.push(gte(alertsTable.createdAt, since));
  if (filters.severities.length > 0) conditions.push(inArray(alertsTable.severity, filters.severities as never[]));
  if (filters.mitreTactics.length > 0) {
    conditions.push(or(...filters.mitreTactics.map((t) => ilike(alertsTable.mitreAttackTactic, `%${t}%`)))!);
  }
  if (filters.resourceTypes.length > 0) conditions.push(inArray(alertsTable.resourceType, filters.resourceTypes as never[]));
  if (filters.accountId) conditions.push(eq(alertsTable.accountId, filters.accountId));
  if (filters.keywords.length > 0) {
    conditions.push(or(...filters.keywords.flatMap((kw) => [
      ilike(alertsTable.title, `%${kw}%`),
      ilike(alertsTable.type, `%${kw}%`),
      ilike(alertsTable.description, `%${kw}%`),
    ]))!);
  }
  return db.select().from(alertsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alertsTable.createdAt)).limit(50);
}

async function generateSummary(query: string, results: AlertRow[], newCount: number): Promise<string> {
  if (results.length === 0) return "No findings matched this scheduled hunt.";
  const client = getClient();
  const top = results.slice(0, 10).map((a) => ({ id: a.id, title: a.title, severity: a.severity, tactic: a.mitreAttackTactic }));
  const resp = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 400,
    messages: [
      { role: "system" as const, content: "You are a SOC analyst. Write brief, actionable threat summaries." },
      { role: "user" as const, content: `Scheduled hunt: "${query}"\nTotal matched: ${results.length} (${newCount} new since last run)\nTop findings: ${JSON.stringify(top)}\n\nWrite a 2-paragraph summary of the threat landscape. Be specific and actionable.` },
    ],
  });
  return resp.choices[0]?.message?.content ?? "Summary unavailable.";
}

// ─── Webhook Notifier ─────────────────────────────────────────────────────────

async function sendWebhook(url: string, payload: object): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "GuardAI/2.0" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Run a Single Scheduled Hunt ─────────────────────────────────────────────

async function runScheduledHunt(hunt: typeof scheduledHuntsTable.$inferSelect): Promise<void> {
  logger.info({ huntId: hunt.id, name: hunt.name }, "Running scheduled hunt");

  try {
    const filters = await interpretQuery(hunt.query);
    const results = await runQuery(filters);
    const newCount = Math.max(0, results.length - hunt.lastMatchCount);
    const summary = await generateSummary(hunt.query, results, newCount);

    // Insert notification
    const [notif] = await db.insert(huntNotificationsTable).values({
      scheduledHuntId: hunt.id,
      huntName: hunt.name,
      query: hunt.query,
      findingsCount: results.length,
      newFindingsCount: newCount,
      summary: summary.slice(0, 2000),
      read: false,
      webhookSent: false,
    }).returning();

    // Webhook
    let webhookSent = false;
    if (hunt.notifyWebhook && results.length > 0) {
      webhookSent = await sendWebhook(hunt.notifyWebhook, {
        event: "scheduled_hunt_complete",
        hunt: { id: hunt.id, name: hunt.name, query: hunt.query },
        results: { total: results.length, newSinceLastRun: newCount },
        summary,
        topFindings: results.slice(0, 5).map((a) => ({
          id: a.id, title: a.title, severity: a.severity,
          tactic: a.mitreAttackTactic, resource: a.affectedResource,
        })),
        timestamp: new Date().toISOString(),
      });

      if (notif) {
        await db.update(huntNotificationsTable)
          .set({ webhookSent })
          .where(eq(huntNotificationsTable.id, notif.id));
      }
    }

    // Update scheduled hunt state
    await db.update(scheduledHuntsTable)
      .set({
        lastRunAt: new Date(),
        nextRunAt: getNextRunAt(hunt.schedule),
        lastMatchCount: results.length,
        updatedAt: new Date(),
      })
      .where(eq(scheduledHuntsTable.id, hunt.id));

    logger.info({ huntId: hunt.id, found: results.length, newCount, webhookSent }, "Scheduled hunt complete");
  } catch (err) {
    logger.error({ err, huntId: hunt.id }, "Scheduled hunt failed");
    // Still update nextRunAt so we retry next cycle
    await db.update(scheduledHuntsTable)
      .set({ nextRunAt: getNextRunAt(hunt.schedule), updatedAt: new Date() })
      .where(eq(scheduledHuntsTable.id, hunt.id));
  }
}

// ─── Scheduler Loop ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // check every minute

export function startHuntScheduler(): void {
  logger.info("Hunt scheduler started");

  const tick = async () => {
    try {
      const due = await db.select().from(scheduledHuntsTable).where(
        and(
          eq(scheduledHuntsTable.enabled, true),
          lte(scheduledHuntsTable.nextRunAt, new Date()),
        )
      );

      for (const hunt of due) {
        void runScheduledHunt(hunt);
      }
    } catch (err) {
      logger.error({ err }, "Hunt scheduler tick failed");
    }
  };

  // Run immediately on startup, then on interval
  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS);
}

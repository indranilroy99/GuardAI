import { Router } from "express";
import { db } from "@workspace/db";
import { alertsTable, alertNotesTable, alertWatchersTable, alertActivityTable } from "@workspace/db";
import { eq, desc, and, gte, inArray } from "drizzle-orm";
import {
  AnalyzeAlertBody,
  ListAlertsQueryParams,
  GetAlertParams,
  DeleteAlertParams,
  UpdateAlertStatusParams,
  UpdateAlertStatusBody,
} from "@workspace/api-zod";
import { analyzeGuardDutyAlert } from "../lib/analyze-alert.js";
import { recordActivity } from "../lib/record-activity.js";

function parseNoteId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseCreateNoteBody(body: unknown): { authorId: string; authorName: string; content: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.authorId !== "string" || !b.authorId.trim()) return null;
  if (typeof b.authorName !== "string" || !b.authorName.trim()) return null;
  if (typeof b.content !== "string" || !b.content.trim() || b.content.length > 4000) return null;
  return { authorId: b.authorId, authorName: b.authorName, content: b.content };
}

const router = Router();

router.get("/alerts", async (req, res) => {
  try {
    const query = ListAlertsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid query parameters" });
      return;
    }

    const conditions = [];
    if (query.data.status) conditions.push(eq(alertsTable.remediationStatus, query.data.status));
    if (query.data.severity) conditions.push(eq(alertsTable.severity, query.data.severity));
    if (query.data.accountId && query.data.accountId !== "all") conditions.push(eq(alertsTable.accountId, query.data.accountId));
    if (query.data.since) {
      const sinceDate = new Date(query.data.since);
      if (!isNaN(sinceDate.getTime())) conditions.push(gte(alertsTable.createdAt, sinceDate));
    }

    const alerts = await db
      .select()
      .from(alertsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alertsTable.createdAt));

    res.json(
      alerts.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/alerts", async (req, res) => {
  try {
    const body = AnalyzeAlertBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body", details: body.error.issues });
      return;
    }

    const analysis = await analyzeGuardDutyAlert(body.data.alertJson);

    const [alert] = await db
      .insert(alertsTable)
      .values({
        title: analysis.title,
        severity: analysis.severity,
        type: analysis.type,
        affectedResource: analysis.affectedResource,
        resourceType: analysis.resourceType,
        region: analysis.region,
        accountId: analysis.accountId,
        description: analysis.description,
        mitreAttackTactic: analysis.mitreAttackTactic,
        mitreAttackTechnique: analysis.mitreAttackTechnique,
        mitreAttackTechniqueId: analysis.mitreAttackTechniqueId,
        mitreAttackMitigation: analysis.mitreAttackMitigation,
        remediationScript: analysis.remediationScript,
        remediationStatus: "generated",
        rawAlert: body.data.alertJson,
      })
      .returning();

    res.status(201).json({
      ...alert,
      createdAt: alert!.createdAt.toISOString(),
      updatedAt: alert!.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to analyze alert");
    res.status(500).json({ error: "Failed to analyze alert" });
  }
});

// Natural language alert query — AI converts plain English to structured filters
router.post("/alerts/nl-query", async (req, res) => {
  try {
    const { query } = req.body as { query?: string };
    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "query is required" });
      return;
    }

    const { openai: client } = await import("@workspace/integrations-openai-ai-server");

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Convert natural language security queries into structured alert filter parameters.
Return a JSON object with optional fields:
- severities: string[] (subset of ["LOW","MEDIUM","HIGH","CRITICAL"])
- statuses: string[] (subset of ["pending","generated","applied","failed"])
- resourceTypes: string[] (subset of ["IAM_ROLE","EC2_INSTANCE","S3_BUCKET","OTHER"])
- mitreTactic: string (partial match)
- searchText: string (general text search across title and resource)
- daysBack: number (filter to last N days)

Example: "critical EC2 findings that are still pending" →
{"severities":["CRITICAL"],"resourceTypes":["EC2_INSTANCE"],"statuses":["pending"]}`,
        },
        { role: "user", content: query },
      ],
    });

    let filters: {
      severities?: string[];
      statuses?: string[];
      resourceTypes?: string[];
      mitreTactic?: string;
      searchText?: string;
      daysBack?: number;
    } = {};

    try {
      filters = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch {
      filters = {};
    }

    // Fetch all alerts and apply parsed filters
    const allAlerts = await db.select().from(alertsTable).orderBy(desc(alertsTable.createdAt));
    const cutoffDate = filters.daysBack
      ? new Date(Date.now() - filters.daysBack * 24 * 60 * 60 * 1000)
      : null;

    const filtered = allAlerts.filter(a => {
      if (filters.severities?.length && !filters.severities.includes(a.severity)) return false;
      if (filters.statuses?.length && !filters.statuses.includes(a.remediationStatus)) return false;
      if (filters.resourceTypes?.length && !filters.resourceTypes.includes(a.resourceType)) return false;
      if (filters.mitreTactic && !a.mitreAttackTactic.toLowerCase().includes(filters.mitreTactic.toLowerCase())) return false;
      if (filters.searchText) {
        const q = filters.searchText.toLowerCase();
        if (!a.title.toLowerCase().includes(q) && !a.affectedResource.toLowerCase().includes(q)) return false;
      }
      if (cutoffDate && a.createdAt < cutoffDate) return false;
      return true;
    });

    res.json(
      filtered.map(a => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "NL query failed");
    res.status(500).json({ error: "Natural language query failed" });
  }
});

router.get("/alerts/stats/summary", async (req, res) => {
  try {
    // Apply account + timeframe filters if provided
    const { accountId, since } = req.query as { accountId?: string; since?: string };
    const conditions = [];
    if (accountId && accountId !== "all") conditions.push(eq(alertsTable.accountId, accountId));
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) conditions.push(gte(alertsTable.createdAt, sinceDate));
    }
    const alerts = await db
      .select()
      .from(alertsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alertsTable.createdAt));

    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const byStatus = { pending: 0, generated: 0, applied: 0, failed: 0 };
    const byResourceType = { IAM_ROLE: 0, EC2_INSTANCE: 0, S3_BUCKET: 0, OTHER: 0 };

    for (const a of alerts) {
      bySeverity[a.severity]++;
      byStatus[a.remediationStatus]++;
      byResourceType[a.resourceType]++;
    }

    // MTTD: average age of unresolved alerts (proxy for detection lag)
    const unresolved = alerts.filter(a => a.remediationStatus !== "applied");
    const mttdMinutes = unresolved.length > 0
      ? unresolved.reduce((sum, a) => sum + (Date.now() - a.createdAt.getTime()) / 60000, 0) / unresolved.length
      : 0;

    // MTTR: average time from creation to resolution for "applied" alerts
    const applied = alerts.filter(a => a.remediationStatus === "applied");
    const mttrMinutes = applied.length > 0
      ? applied.reduce((sum, a) => sum + (a.updatedAt.getTime() - a.createdAt.getTime()) / 60000, 0) / applied.length
      : 0;

    // Stale findings: pending > 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleFindings = alerts.filter(a => a.remediationStatus === "pending" && a.createdAt < oneDayAgo).length;

    // Threat velocity: alerts per day for last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const velocityMap: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      velocityMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const a of alerts) {
      const key = a.createdAt.toISOString().slice(0, 10);
      if (key in velocityMap) velocityMap[key]++;
    }
    const threatVelocity = Object.entries(velocityMap).map(([date, count]) => ({ date, count }));

    // Top targeted resources (by hit count)
    const resourceMap: Record<string, { count: number; severity: string }> = {};
    const sevOrder: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    for (const a of alerts) {
      if (!resourceMap[a.affectedResource]) {
        resourceMap[a.affectedResource] = { count: 0, severity: a.severity };
      }
      resourceMap[a.affectedResource].count++;
      if ((sevOrder[a.severity] ?? 0) > (sevOrder[resourceMap[a.affectedResource].severity] ?? 0)) {
        resourceMap[a.affectedResource].severity = a.severity;
      }
    }
    const topResources = Object.entries(resourceMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([resource, { count, severity }]) => ({ resource, count, topSeverity: severity }));

    const recentActivity = alerts.slice(0, 10).map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));

    const activeAccountCount = new Set(alerts.map(a => a.accountId)).size;

    res.json({
      total: alerts.length,
      bySeverity,
      byStatus,
      byResourceType,
      recentActivity,
      mttdMinutes: Math.round(mttdMinutes),
      mttrMinutes: Math.round(mttrMinutes),
      staleFindings,
      threatVelocity,
      topResources,
      activeAccountCount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get alert stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/alerts/:id", async (req, res) => {
  try {
    const params = GetAlertParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [alert] = await db
      .select()
      .from(alertsTable)
      .where(eq(alertsTable.id, params.data.id));

    if (!alert) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    res.json({
      ...alert,
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/alerts/:id", async (req, res) => {
  try {
    const params = DeleteAlertParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    await db.delete(alertsTable).where(eq(alertsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/alerts/:id/status", async (req, res) => {
  try {
    const params = UpdateAlertStatusParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const body = UpdateAlertStatusBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const [updated] = await db
      .update(alertsTable)
      .set({
        remediationStatus: body.data.remediationStatus,
        ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(alertsTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });

    // Record activity for watchers
    const actorId = (req as any).auth?.userId ?? "system";
    const actorName = (req as any).auth?.username ?? "System";
    void recordActivity(
      updated.id,
      updated.title,
      "status_change",
      `Status changed to "${body.data.remediationStatus}"`,
      actorId,
      actorName,
    );
  } catch (err) {
    req.log.error({ err }, "Failed to update alert status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Alert Notes ─────────────────────────────────────────────────────────────

router.get("/alerts/:id/notes", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    if (!alertId) { res.status(400).json({ error: "Invalid ID" }); return; }

    const alertRow = await db.select({ id: alertsTable.id }).from(alertsTable).where(eq(alertsTable.id, alertId));
    if (!alertRow.length) { res.status(404).json({ error: "Alert not found" }); return; }

    const notes = await db
      .select()
      .from(alertNotesTable)
      .where(eq(alertNotesTable.alertId, alertId))
      .orderBy(desc(alertNotesTable.createdAt));

    res.json(notes.map(n => ({ ...n, createdAt: n.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Failed to list notes");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/alerts/:id/notes", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    if (!alertId) { res.status(400).json({ error: "Invalid ID" }); return; }

    const body = parseCreateNoteBody(req.body);
    if (!body) { res.status(400).json({ error: "Invalid body: authorId, authorName, and content are required" }); return; }

    const alertRow = await db.select({ id: alertsTable.id }).from(alertsTable).where(eq(alertsTable.id, alertId));
    if (!alertRow.length) { res.status(404).json({ error: "Alert not found" }); return; }

    const [note] = await db
      .insert(alertNotesTable)
      .values({ alertId, authorId: body.authorId, authorName: body.authorName, content: body.content })
      .returning();

    res.status(201).json({ ...note, createdAt: note!.createdAt.toISOString() });

    // Record activity for watchers
    void recordActivity(
      alertId,
      alertRow[0]?.id ? `Alert #${alertId}` : `Alert #${alertId}`,
      "note_added",
      `Note added: "${body.content.slice(0, 80)}${body.content.length > 80 ? "…" : ""}"`,
      body.authorId,
      body.authorName,
    );
  } catch (err) {
    req.log.error({ err }, "Failed to create note");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/alerts/:id/notes/:noteId", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    const noteId = parseNoteId(req.params.noteId);
    if (!alertId || !noteId) { res.status(400).json({ error: "Invalid params" }); return; }

    const deleted = await db
      .delete(alertNotesTable)
      .where(and(eq(alertNotesTable.id, noteId), eq(alertNotesTable.alertId, alertId)))
      .returning({ id: alertNotesTable.id });

    if (!deleted.length) { res.status(404).json({ error: "Note not found" }); return; }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete note");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Alert Activity (per-alert change history) ────────────────────────────────

router.get("/alerts/:id/activity", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    if (!alertId) { res.status(400).json({ error: "Invalid ID" }); return; }

    const alertRow = await db.select({ id: alertsTable.id, title: alertsTable.title })
      .from(alertsTable).where(eq(alertsTable.id, alertId));
    if (!alertRow.length) { res.status(404).json({ error: "Alert not found" }); return; }

    const events = await db
      .select()
      .from(alertActivityTable)
      .where(eq(alertActivityTable.alertId, alertId))
      .orderBy(desc(alertActivityTable.createdAt));

    res.json(events.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Failed to get alert activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Alert Watchers ───────────────────────────────────────────────────────────

router.get("/alerts/:id/watch", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    const userId = typeof req.query.userId === "string" ? req.query.userId : null;
    if (!alertId || !userId) { res.status(400).json({ error: "Invalid params" }); return; }

    const watchers = await db.select({ id: alertWatchersTable.id, userId: alertWatchersTable.userId })
      .from(alertWatchersTable).where(eq(alertWatchersTable.alertId, alertId));

    res.json({ watching: watchers.some(w => w.userId === userId), watcherCount: watchers.length });
  } catch (err) {
    req.log.error({ err }, "Failed to get watch status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/alerts/:id/watch", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    if (!alertId) { res.status(400).json({ error: "Invalid ID" }); return; }

    const body = req.body as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId : null;
    const userName = typeof body.userName === "string" ? body.userName : null;
    if (!userId || !userName) { res.status(400).json({ error: "userId and userName required" }); return; }

    // Idempotent — don't double-insert
    const existing = await db.select({ id: alertWatchersTable.id })
      .from(alertWatchersTable)
      .where(and(eq(alertWatchersTable.alertId, alertId), eq(alertWatchersTable.userId, userId)));

    if (!existing.length) {
      await db.insert(alertWatchersTable).values({ alertId, userId, userName });
    }

    const watchers = await db.select({ userId: alertWatchersTable.userId })
      .from(alertWatchersTable).where(eq(alertWatchersTable.alertId, alertId));

    res.status(201).json({ watching: true, watcherCount: watchers.length });
  } catch (err) {
    req.log.error({ err }, "Failed to watch alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/alerts/:id/watch", async (req, res) => {
  try {
    const alertId = parseNoteId(req.params.id);
    const userId = typeof req.query.userId === "string" ? req.query.userId : null;
    if (!alertId || !userId) { res.status(400).json({ error: "Invalid params" }); return; }

    await db.delete(alertWatchersTable)
      .where(and(eq(alertWatchersTable.alertId, alertId), eq(alertWatchersTable.userId, userId)));

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to unwatch alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── User Notifications (activity feed for watched alerts) ────────────────────

router.get("/user/notifications", async (req, res) => {
  try {
    const userId = typeof req.query.userId === "string" ? req.query.userId : null;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }

    const since = typeof req.query.since === "string" ? new Date(req.query.since) : null;

    // Get all alert IDs this user is watching
    const watched = await db.select({ alertId: alertWatchersTable.alertId })
      .from(alertWatchersTable).where(eq(alertWatchersTable.userId, userId));

    if (!watched.length) { res.json([]); return; }

    const alertIds = watched.map(w => w.alertId);
    let query = db.select().from(alertActivityTable)
      .where(
        since
          ? and(inArray(alertActivityTable.alertId, alertIds), gte(alertActivityTable.createdAt, since))
          : inArray(alertActivityTable.alertId, alertIds)
      )
      .orderBy(desc(alertActivityTable.createdAt))
      .limit(50);

    const events = await query;
    res.json(events.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Failed to get user notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

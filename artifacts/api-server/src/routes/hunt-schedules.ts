/**
 * Scheduled Hunt Routes
 *
 * CRUD for scheduled hunts and in-app notification retrieval.
 *
 * GET    /api/hunt/schedules           — list all scheduled hunts
 * POST   /api/hunt/schedules           — create a scheduled hunt
 * PATCH  /api/hunt/schedules/:id       — update (enable/disable, change schedule)
 * DELETE /api/hunt/schedules/:id       — remove
 *
 * GET    /api/hunt/notifications       — unread in-app notifications
 * PATCH  /api/hunt/notifications/:id/read  — mark as read
 * POST   /api/hunt/notifications/read-all  — mark all read
 */

import { Router } from "express";
import { db, scheduledHuntsTable, huntNotificationsTable } from "@workspace/db";
import { eq, desc, and, eq as eqAlias } from "drizzle-orm";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_SCHEDULES = ["hourly", "daily", "weekly"] as const;
type Schedule = (typeof VALID_SCHEDULES)[number];

function isValidSchedule(v: unknown): v is Schedule {
  return VALID_SCHEDULES.includes(v as Schedule);
}

function nextRunAt(schedule: string): Date {
  const now = new Date();
  switch (schedule) {
    case "hourly": return new Date(now.getTime() + 3_600_000);
    case "weekly": return new Date(now.getTime() + 7 * 86_400_000);
    default:       return new Date(now.getTime() + 86_400_000);
  }
}

interface CreateBody {
  name?: unknown;
  query?: unknown;
  schedule?: unknown;
  notifyWebhook?: unknown;
  notifyEmail?: unknown;
  runNow?: unknown;
}

interface PatchBody {
  name?: unknown;
  query?: unknown;
  schedule?: unknown;
  enabled?: unknown;
  notifyWebhook?: unknown;
  notifyEmail?: unknown;
}

// ─── Scheduled Hunts ─────────────────────────────────────────────────────────

router.get("/hunt/schedules", async (req, res) => {
  try {
    const schedules = await db.select().from(scheduledHuntsTable).orderBy(desc(scheduledHuntsTable.createdAt));
    res.json(schedules.map((s) => ({
      ...s,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      nextRunAt: s.nextRunAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list scheduled hunts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/hunt/schedules", async (req, res) => {
  const b = req.body as CreateBody;
  if (typeof b.name !== "string" || !b.name.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (typeof b.query !== "string" || (b.query as string).length < 3) { res.status(400).json({ error: "query must be at least 3 chars" }); return; }
  const schedule: Schedule = isValidSchedule(b.schedule) ? b.schedule : "daily";
  const notifyWebhook = typeof b.notifyWebhook === "string" && b.notifyWebhook.trim() ? b.notifyWebhook.trim() : null;
  const notifyEmail = typeof b.notifyEmail === "string" && b.notifyEmail.trim() ? b.notifyEmail.trim() : null;
  const runNow = b.runNow === true;

  try {
    const [row] = await db.insert(scheduledHuntsTable).values({
      name: (b.name as string).trim(),
      query: (b.query as string).trim(),
      schedule,
      notifyWebhook,
      notifyEmail,
      enabled: true,
      nextRunAt: runNow ? new Date(0) : nextRunAt(schedule),
      lastMatchCount: 0,
    }).returning();

    res.status(201).json({
      ...row,
      lastRunAt: row!.lastRunAt?.toISOString() ?? null,
      nextRunAt: row!.nextRunAt.toISOString(),
      createdAt: row!.createdAt.toISOString(),
      updatedAt: row!.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create scheduled hunt");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/hunt/schedules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const b = req.body as PatchBody;

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof b.name === "string" && b.name.trim()) updates.name = b.name.trim();
    if (typeof b.query === "string" && (b.query as string).length >= 3) updates.query = b.query;
    if (isValidSchedule(b.schedule)) { updates.schedule = b.schedule; updates.nextRunAt = nextRunAt(b.schedule); }
    if (typeof b.enabled === "boolean") updates.enabled = b.enabled;
    if (b.enabled === true && !isValidSchedule(b.schedule)) {
      const existing = await db.select().from(scheduledHuntsTable).where(eq(scheduledHuntsTable.id, id));
      if (existing[0]) updates.nextRunAt = nextRunAt(existing[0].schedule);
    }
    if ("notifyWebhook" in b) updates.notifyWebhook = typeof b.notifyWebhook === "string" ? b.notifyWebhook : null;
    if ("notifyEmail" in b) updates.notifyEmail = typeof b.notifyEmail === "string" ? b.notifyEmail : null;

    const [row] = await db.update(scheduledHuntsTable).set(updates).where(eq(scheduledHuntsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    res.json({
      ...row,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      nextRunAt: row.nextRunAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update scheduled hunt");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/hunt/schedules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(scheduledHuntsTable).where(eq(scheduledHuntsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete scheduled hunt");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Notifications ────────────────────────────────────────────────────────────

router.get("/hunt/notifications", async (req, res) => {
  try {
    const rows = await db.select().from(huntNotificationsTable)
      .orderBy(desc(huntNotificationsTable.createdAt))
      .limit(50);
    res.json(rows.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Failed to list hunt notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/hunt/notifications/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.update(huntNotificationsTable).set({ read: true }).where(eq(huntNotificationsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to mark notification read");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/hunt/notifications/read-all", async (req, res) => {
  try {
    await db.update(huntNotificationsTable).set({ read: true }).where(eqAlias(huntNotificationsTable.read, false));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to mark all notifications read");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

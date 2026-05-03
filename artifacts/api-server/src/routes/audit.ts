import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

router.get("/audit", async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit as string);
    const limit = isNaN(rawLimit) ? 200 : Math.min(rawLimit, 1000);
    const severity = req.query.severity as string | undefined;

    const logs = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    const filtered =
      severity && ["INFO", "WARN", "ERROR"].includes(severity)
        ? logs.filter(l => l.severity === severity)
        : logs;

    res.json(
      filtered.map(l => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to get audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

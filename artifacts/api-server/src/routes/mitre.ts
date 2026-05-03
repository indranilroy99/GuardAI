/**
 * MITRE ATT&CK Heatmap Route
 *
 * GET /api/mitre/heatmap
 *   Returns alert counts grouped by tactic + technique for the ATT&CK matrix.
 */

import { Router } from "express";
import { db, alertsTable } from "@workspace/db";

const router = Router();

router.get("/mitre/heatmap", async (req, res) => {
  try {
    const rows = await db
      .select({
        mitreAttackTactic: alertsTable.mitreAttackTactic,
        mitreAttackTechnique: alertsTable.mitreAttackTechnique,
        mitreAttackTechniqueId: alertsTable.mitreAttackTechniqueId,
        severity: alertsTable.severity,
        id: alertsTable.id,
      })
      .from(alertsTable);

    // Group by tactic → techniqueId
    type Cell = {
      techniqueId: string;
      technique: string;
      tactic: string;
      count: number;
      bySeverity: Record<string, number>;
      ids: number[];
    };

    const cellMap = new Map<string, Cell>();

    for (const row of rows) {
      const key = `${row.mitreAttackTactic}||${row.mitreAttackTechniqueId}`;
      if (!cellMap.has(key)) {
        cellMap.set(key, {
          techniqueId: row.mitreAttackTechniqueId,
          technique: row.mitreAttackTechnique,
          tactic: row.mitreAttackTactic,
          count: 0,
          bySeverity: {},
          ids: [],
        });
      }
      const cell = cellMap.get(key)!;
      cell.count++;
      cell.bySeverity[row.severity] = (cell.bySeverity[row.severity] ?? 0) + 1;
      cell.ids.push(row.id);
    }

    const cells = Array.from(cellMap.values());

    // Tactic summary
    const tacticCounts = cells.reduce<Record<string, number>>((acc, c) => {
      acc[c.tactic] = (acc[c.tactic] ?? 0) + c.count;
      return acc;
    }, {});

    const hottestTactic = Object.entries(tacticCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const hottestCell = cells.sort((a, b) => b.count - a.count)[0];

    res.json({
      cells,
      totalAlerts: rows.length,
      uniqueTechniques: cellMap.size,
      uniqueTactics: Object.keys(tacticCounts).length,
      hottestTactic,
      hottestTechnique: hottestCell ? { id: hottestCell.techniqueId, name: hottestCell.technique, count: hottestCell.count } : null,
      tacticCounts,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build MITRE heatmap");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

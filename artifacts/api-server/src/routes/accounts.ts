/**
 * AWS Accounts Router — Multi-account management
 *
 * GET    /api/accounts        — list all accounts
 * POST   /api/accounts        — register a new account
 * PATCH  /api/accounts/:id    — update account
 * DELETE /api/accounts/:id    — remove account
 */

import { Router } from "express";
import { db, awsAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes, createHmac } from "crypto";

const router = Router();

router.get("/accounts", async (_req, res) => {
  const accounts = await db.select().from(awsAccountsTable).orderBy(awsAccountsTable.createdAt);
  res.json(accounts);
});

router.post("/accounts", async (req, res) => {
  const { name, accountId, region, environment, notes } = req.body as {
    name?: string;
    accountId?: string;
    region?: string;
    environment?: string;
    notes?: string;
  };

  if (!name || !accountId) {
    res.status(400).json({ error: "name and accountId are required" });
    return;
  }

  try {
    const [account] = await db.insert(awsAccountsTable).values({
      name,
      accountId,
      region: region ?? "us-east-1",
      environment: environment ?? "production",
      webhookToken: createHmac("sha256", randomBytes(32)).update(accountId + Date.now()).digest("hex"),
      notes: notes ?? null,
    }).returning();

    res.status(201).json(account);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique")) {
      res.status(409).json({ error: "An account with this Account ID already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

router.patch("/accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, region, environment, status, notes } = req.body as {
    name?: string;
    region?: string;
    environment?: string;
    status?: string;
    notes?: string;
  };

  const [updated] = await db.update(awsAccountsTable)
    .set({ name, region, environment, status, notes, updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(awsAccountsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Account not found" }); return; }
  res.json(updated);
});

router.delete("/accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(awsAccountsTable).where(eq(awsAccountsTable.id, id));
  res.status(204).send();
});

export default router;

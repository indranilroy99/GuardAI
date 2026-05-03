/**
 * Notifications Router
 *
 *   GET  /api/notifications/config        — get channel config (auth required)
 *   PUT  /api/notifications/config        — update config (auth required)
 *   POST /api/notifications/test/slack    — fire a Slack test message
 *   POST /api/notifications/test/email    — fire an email test message
 */
import { Router } from "express";
import { getNotificationConfig, updateNotificationConfig } from "../lib/notification-config.js";
import { appendIntegrationLog } from "./integrations.js";
import { logger } from "../lib/logger.js";
import nodemailer from "nodemailer";

const router = Router();

// ─── GET config ──────────────────────────────────────────────────────────────

router.get("/notifications/config", (_req, res) => {
  const cfg = getNotificationConfig();
  // Mask SMTP password in response
  res.json({
    ...cfg,
    email: {
      ...cfg.email,
      smtpPass: cfg.email.smtpPass ? "••••••••" : "",
    },
  });
});

// ─── PUT config ──────────────────────────────────────────────────────────────

router.put("/notifications/config", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const incoming = body as Parameters<typeof updateNotificationConfig>[0];

  // Don't overwrite stored password if client sends masked placeholder
  if (incoming.email?.smtpPass === "••••••••") {
    incoming.email.smtpPass = getNotificationConfig().email.smtpPass;
  }

  const updated = updateNotificationConfig(incoming);
  appendIntegrationLog({ level: "info", event: "NOTIF_CONFIG_UPDATED", detail: `Channels: slack=${updated.slack.enabled}, email=${updated.email.enabled}` });
  res.json({ ok: true, config: { ...updated, email: { ...updated.email, smtpPass: updated.email.smtpPass ? "••••••••" : "" } } });
});

// ─── Test Slack ───────────────────────────────────────────────────────────────

router.post("/notifications/test/slack", async (req, res) => {
  const cfg = getNotificationConfig();
  const url = (req.body as { webhookUrl?: string }).webhookUrl ?? cfg.slack.webhookUrl;

  if (!url) {
    res.status(400).json({ error: "No Slack webhook URL configured" });
    return;
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ *GuardAI test notification* — Slack channel is connected correctly.",
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Slack returned ${r.status}: ${body}`);
    }
    appendIntegrationLog({ level: "info", event: "SLACK_TEST_OK", detail: "Test notification delivered" });
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendIntegrationLog({ level: "error", event: "SLACK_TEST_FAILED", detail: msg });
    logger.error({ err }, "Slack test failed");
    res.status(500).json({ error: msg });
  }
});

// ─── Test Email ───────────────────────────────────────────────────────────────

router.post("/notifications/test/email", async (req, res) => {
  const cfg = getNotificationConfig();
  const body = req.body as { smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; smtpPass?: string; fromAddress?: string; toAddresses?: string[] };

  const host = body.smtpHost ?? cfg.email.smtpHost;
  const port = body.smtpPort ?? cfg.email.smtpPort;
  const secure = body.smtpSecure ?? cfg.email.smtpSecure;
  const user = body.smtpUser ?? cfg.email.smtpUser;
  const pass = (body.smtpPass && body.smtpPass !== "••••••••") ? body.smtpPass : cfg.email.smtpPass;
  const from = body.fromAddress ?? cfg.email.fromAddress;
  const to = body.toAddresses ?? cfg.email.toAddresses;

  if (!host || to.length === 0) {
    res.status(400).json({ error: "SMTP host and at least one recipient are required" });
    return;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  try {
    await transport.sendMail({
      from: from || `"GuardAI" <no-reply@guardai>`,
      to: to.join(", "),
      subject: "[GuardAI] Test notification — email channel connected",
      text: "Your GuardAI email notification channel is working correctly.",
    });
    appendIntegrationLog({ level: "info", event: "EMAIL_TEST_OK", detail: `Test sent to ${to.join(", ")}` });
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendIntegrationLog({ level: "error", event: "EMAIL_TEST_FAILED", detail: msg });
    logger.error({ err }, "Email test failed");
    res.status(500).json({ error: msg });
  }
});

export default router;

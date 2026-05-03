/**
 * Alert notifier — fires Slack and/or email when a new finding meets
 * the configured severity threshold.
 */
import nodemailer from "nodemailer";
import { getNotificationConfig, type SeverityThreshold } from "./notification-config.js";
import { logger } from "./logger.js";
import { appendIntegrationLog } from "../routes/integrations.js";

const SEVERITY_ORDER: SeverityThreshold[] = ["MEDIUM", "HIGH", "CRITICAL"];

export function meetsThreshold(severity: string, threshold: SeverityThreshold): boolean {
  const sevIdx = SEVERITY_ORDER.indexOf(severity as SeverityThreshold);
  const thrIdx = SEVERITY_ORDER.indexOf(threshold);
  return sevIdx >= thrIdx && sevIdx !== -1;
}

// ─── Slack ────────────────────────────────────────────────────────────────────

async function sendSlack(alertId: number, title: string, severity: string, source: string) {
  const cfg = getNotificationConfig();
  if (!cfg.slack.enabled || !cfg.slack.webhookUrl) return;

  const color = severity === "CRITICAL" ? "#f14c4c" : severity === "HIGH" ? "#ff9900" : "#f5c518";
  const mention = cfg.slack.mentionChannel ? "<!channel> " : "";

  const payload = {
    attachments: [
      {
        color,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${mention}*GuardAI — New ${severity} Finding*`,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Alert ID*\n#${alertId}` },
              { type: "mrkdwn", text: `*Severity*\n${severity}` },
              { type: "mrkdwn", text: `*Title*\n${title}` },
              { type: "mrkdwn", text: `*Source*\n${source}` },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View Alert →" },
                url: `https://${process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost"}/alerts/${alertId}`,
                style: "danger",
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(cfg.slack.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Slack webhook returned ${res.status}: ${body}`);
    }
    appendIntegrationLog({ level: "info", event: "SLACK_SENT", detail: `Alert #${alertId} — ${severity}: ${title}` });
    logger.info({ alertId, severity }, "Slack notification sent");
  } catch (err) {
    appendIntegrationLog({ level: "error", event: "SLACK_FAILED", detail: String(err instanceof Error ? err.message : err) });
    logger.error({ err }, "Slack notification failed");
  }
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(alertId: number, title: string, severity: string, source: string) {
  const cfg = getNotificationConfig();
  if (!cfg.email.enabled || !cfg.email.smtpHost || cfg.email.toAddresses.length === 0) return;

  const transport = nodemailer.createTransport({
    host: cfg.email.smtpHost,
    port: cfg.email.smtpPort,
    secure: cfg.email.smtpSecure,
    auth: cfg.email.smtpUser ? { user: cfg.email.smtpUser, pass: cfg.email.smtpPass } : undefined,
  });

  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  const alertUrl = `https://${domain}/alerts/${alertId}`;
  const severityColor = severity === "CRITICAL" ? "#f14c4c" : severity === "HIGH" ? "#ff9900" : "#f5c518";

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f1923;font-family:'Inter',sans-serif;color:#e2e8f0;">
  <div style="max-width:520px;margin:40px auto;background:#141f2e;border:1px solid #1f2f40;border-radius:4px;overflow:hidden;">
    <div style="padding:16px 24px;background:#0d1520;border-bottom:1px solid #1f2f40;display:flex;align-items:center;gap:10px;">
      <span style="font-weight:700;font-size:14px;color:#ff9900;">GuardAI</span>
      <span style="color:#415161;font-size:11px;">Security Operations</span>
    </div>
    <div style="padding:28px 24px;">
      <div style="display:inline-block;padding:4px 10px;border-radius:3px;font-size:11px;font-weight:700;font-family:monospace;margin-bottom:16px;background:${severityColor}20;color:${severityColor};border:1px solid ${severityColor}50;">
        ${severity} FINDING
      </div>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#e2e8f0;line-height:1.3;">${title}</h2>
      <p style="margin:0 0 24px;font-size:12px;color:#7f9ab0;">Alert #${alertId} · Source: ${source}</p>
      <a href="${alertUrl}" style="display:inline-block;padding:10px 20px;background:#ff9900;color:#000;font-weight:700;font-size:12px;text-decoration:none;border-radius:3px;">
        View Alert →
      </a>
    </div>
    <div style="padding:12px 24px;background:#0d1520;border-top:1px solid #1f2f40;font-size:10px;color:#415161;font-family:monospace;">
      GuardAI · AWS GuardDuty Security Operations Platform
    </div>
  </div>
</body>
</html>`;

  try {
    await transport.sendMail({
      from: cfg.email.fromAddress || `"GuardAI Alerts" <alerts@${domain}>`,
      to: cfg.email.toAddresses.join(", "),
      subject: `[GuardAI] ${severity} — ${title}`,
      html,
    });
    appendIntegrationLog({ level: "info", event: "EMAIL_SENT", detail: `Alert #${alertId} → ${cfg.email.toAddresses.join(", ")}` });
    logger.info({ alertId, severity }, "Email notification sent");
  } catch (err) {
    appendIntegrationLog({ level: "error", event: "EMAIL_FAILED", detail: String(err instanceof Error ? err.message : err) });
    logger.error({ err }, "Email notification failed");
  }
}

// ─── Public dispatcher ────────────────────────────────────────────────────────

export async function dispatchAlertNotification(
  alertId: number,
  title: string,
  severity: string,
  source: string,
) {
  const cfg = getNotificationConfig();
  if (!meetsThreshold(severity, cfg.severityThreshold)) return;

  await Promise.allSettled([
    sendSlack(alertId, title, severity, source),
    sendEmail(alertId, title, severity, source),
  ]);
}

/**
 * Integrations Router
 *
 * Handles:
 *   GET  /api/integrations/config         — webhook URL + token (auth required)
 *   POST /api/integrations/guardduty/webhook — GuardDuty finding ingest (token auth)
 *   GET  /api/alerts/stream               — SSE real-time event stream (auth required)
 */

import { Router } from "express";
import { db, alertsTable } from "@workspace/db";
import { getWebhookToken, validateWebhookToken } from "../lib/webhook-token.js";
import { analyzeGuardDutyAlert } from "../lib/analyze-alert.js";
import { runTriageAgent } from "../lib/triage-agent.js";
import { addSseClient, removeSseClient, getSseClientCount } from "../lib/sse.js";
import { broadcastSseEvent } from "../lib/sse.js";
import { logger } from "../lib/logger.js";
import { dispatchAlertNotification } from "../lib/notifier.js";

const router = Router();

// ─── Webhook Config ──────────────────────────────────────────────────────────

router.get("/integrations/config", (req, res) => {
  const token = getWebhookToken();
  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  const primaryDomain = domains[0] ?? "your-app.replit.app";
  const webhookUrl = `https://${primaryDomain}/api/integrations/guardduty/webhook`;

  res.json({
    webhookUrl,
    webhookToken: token,
    events: ["GuardDuty Finding"],
    autoTriageEnabled: true,
    sseEndpoint: `${webhookUrl.replace("/integrations/guardduty/webhook", "/alerts/stream")}`,
    setupInstructions: {
      eventbridge: {
        ruleName: "GuardDuty-to-Sentinel",
        pattern: { source: ["aws.guardduty"] },
        target: "API Destination",
        headers: { "X-GuardAI-Token": token },
        url: webhookUrl,
      },
    },
  });
});

// ─── Integration Debug Log storage (in-memory, last 200 entries) ─────────────

export type IntegrationLogEntry = {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  event: string;
  detail: string;
  requestId?: string;
};

const integrationLogs: IntegrationLogEntry[] = [];

export function appendIntegrationLog(entry: Omit<IntegrationLogEntry, "ts">) {
  integrationLogs.unshift({ ...entry, ts: Date.now() });
  if (integrationLogs.length > 200) integrationLogs.pop();
}

router.get("/integrations/logs", (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query["limit"] ?? "100"), 10) || 100);
  res.json({ logs: integrationLogs.slice(0, limit) });
});

// ─── GuardDuty Webhook ───────────────────────────────────────────────────────

router.post("/integrations/guardduty/webhook", async (req, res) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  // Accept both X-GuardAI-Token (new) and X-Sentinel-Token (legacy)
  const token = (req.headers["x-guardai-token"] ?? req.headers["x-sentinel-token"]) as string | undefined;
  if (!validateWebhookToken(token ?? "")) {
    appendIntegrationLog({ level: "error", event: "AUTH_FAILED", detail: `Invalid or missing token from ${req.ip}`, requestId: reqId });
    res.status(401).json({ error: "Invalid or missing X-GuardAI-Token" });
    return;
  }
  appendIntegrationLog({ level: "info", event: "WEBHOOK_RECEIVED", detail: `Incoming finding from ${req.ip}`, requestId: reqId });

  let body = req.body as Record<string, unknown>;

  // Unwrap SNS notification envelope
  if (body.Type === "Notification" && typeof body.Message === "string") {
    try {
      body = JSON.parse(body.Message) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Failed to parse SNS Message" });
      return;
    }
  }

  // Unwrap EventBridge envelope: { "detail-type": "GuardDuty Finding", "detail": {...} }
  let finding: Record<string, unknown>;
  if (body["detail-type"] === "GuardDuty Finding" && body.detail) {
    finding = body.detail as Record<string, unknown>;
  } else if (body.schemaVersion || body.type || body.Type) {
    // Already a raw GuardDuty finding
    finding = body;
  } else {
    res.status(400).json({ error: "Unrecognized payload format. Expected EventBridge envelope or raw GuardDuty finding." });
    return;
  }

  const findingJson = JSON.stringify(finding);
  res.status(202).json({ message: "Finding received. Auto-triage started.", queued: true });

  // Run analysis + triage in background (non-blocking)
  setImmediate(async () => {
    try {
      appendIntegrationLog({ level: "info", event: "AI_ANALYSIS_START", detail: "Analyzing finding with AI model", requestId: reqId });
      const analysis = await analyzeGuardDutyAlert(findingJson);
      appendIntegrationLog({ level: "info", event: "AI_ANALYSIS_DONE", detail: `Title: ${analysis.title} · Severity: ${analysis.severity}`, requestId: reqId });

      const [alert] = await db.insert(alertsTable).values({
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
        rawAlert: findingJson,
        triageStatus: "pending",
        source: "webhook",
      }).returning();

      appendIntegrationLog({ level: "info", event: "ALERT_CREATED", detail: `Alert #${alert!.id} created in DB`, requestId: reqId });

      // Notify clients of new alert before triage starts
      broadcastSseEvent("new-alert", {
        alertId: alert!.id,
        title: analysis.title,
        severity: analysis.severity,
        source: "webhook",
      });

      // Fire Slack / email notification if severity meets threshold
      void dispatchAlertNotification(alert!.id, analysis.title, analysis.severity, "webhook");

      appendIntegrationLog({ level: "info", event: "TRIAGE_START", detail: `Launching triage agent for alert #${alert!.id}`, requestId: reqId });
      // Launch multi-stage triage (non-blocking)
      runTriageAgent(alert!.id, findingJson, analysis as unknown as Record<string, string>).catch((err) => {
        appendIntegrationLog({ level: "error", event: "TRIAGE_FAILED", detail: String(err instanceof Error ? err.message : err), requestId: reqId });
        logger.error({ err, alertId: alert!.id }, "Triage agent failed");
      });
    } catch (err) {
      appendIntegrationLog({ level: "error", event: "PROCESSING_FAILED", detail: String(err instanceof Error ? err.message : err), requestId: reqId });
      logger.error({ err }, "Webhook background processing failed");
    }
  });
});

// ─── In-UI Test Fire ─────────────────────────────────────────────────────────

router.post("/integrations/test", async (req, res) => {
  const finding = {
    schemaVersion: "2.0",
    accountId: "123456789012",
    region: "us-east-1",
    partition: "aws",
    id: `test-finding-${Date.now()}`,
    type: "UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B",
    severity: 8,
    title: "Unusual console login from anonymous proxy (Test)",
    description:
      "An IAM user successfully logged into the AWS Management Console from an anonymous proxy. This is a simulated test finding.",
    service: {
      action: {
        actionType: "AWS_API_CALL",
        awsApiCallAction: {
          api: "ConsoleLogin",
          serviceName: "signin.amazonaws.com",
          remoteIpDetails: {
            ipAddressV4: "185.220.101.47",
            country: { countryName: "Germany" },
            organization: { asn: "204066", asnOrg: "Tor Project" },
          },
        },
      },
    },
    resource: {
      resourceType: "AccessKey",
      accessKeyDetails: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        principalId: "AIDACKCEVSQ6C2EXAMPLE",
        userType: "IAMUser",
        userName: "TestFindingUser",
      },
    },
  };

  const findingJson = JSON.stringify(finding);
  res.status(202).json({ message: "Test finding queued. Auto-triage starting…", queued: true });

  const testReqId = crypto.randomUUID().slice(0, 8);
  setImmediate(async () => {
    try {
      appendIntegrationLog({ level: "debug", event: "TEST_FIRE", detail: "Synthetic GuardDuty finding submitted", requestId: testReqId });
      const { analyzeGuardDutyAlert } = await import("../lib/analyze-alert.js");
      appendIntegrationLog({ level: "info", event: "AI_ANALYSIS_START", detail: "Analyzing test finding", requestId: testReqId });
      const analysis = await analyzeGuardDutyAlert(findingJson);
      appendIntegrationLog({ level: "info", event: "AI_ANALYSIS_DONE", detail: `Title: ${analysis.title} · Severity: ${analysis.severity}`, requestId: testReqId });

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
          rawAlert: findingJson,
          triageStatus: "pending",
          source: "webhook",
        })
        .returning();

      appendIntegrationLog({ level: "info", event: "ALERT_CREATED", detail: `Test alert #${alert!.id} created`, requestId: testReqId });
      broadcastSseEvent("new-alert", {
        alertId: alert!.id,
        title: analysis.title,
        severity: analysis.severity,
        source: "test",
      });

      void dispatchAlertNotification(alert!.id, analysis.title, analysis.severity, "test");

      appendIntegrationLog({ level: "info", event: "TRIAGE_START", detail: `Launching triage agent for test alert #${alert!.id}`, requestId: testReqId });
      runTriageAgent(
        alert!.id,
        findingJson,
        analysis as unknown as Record<string, string>,
      ).catch((err) => {
        appendIntegrationLog({ level: "error", event: "TRIAGE_FAILED", detail: String(err instanceof Error ? err.message : err), requestId: testReqId });
        logger.error({ err, alertId: alert!.id }, "Test triage agent failed");
      });
    } catch (err) {
      appendIntegrationLog({ level: "error", event: "TEST_FAILED", detail: String(err instanceof Error ? err.message : err), requestId: testReqId });
      logger.error({ err }, "Test webhook background processing failed");
    }
  });
});

// ─── SSE Stream ──────────────────────────────────────────────────────────────

router.get("/alerts/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ clients: getSseClientCount() + 1, ts: Date.now() })}\n\n`);

  const clientId = addSseClient(res);

  // Keepalive ping every 25s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeSseClient(clientId);
  });
});

export default router;

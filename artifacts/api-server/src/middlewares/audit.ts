import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const sanitized = { ...(body as Record<string, unknown>) };
  const sensitiveFields = ["secretAccessKey", "accessKeyId", "sessionToken", "apiKey", "password"];
  for (const field of sensitiveFields) {
    if (sanitized[field]) sanitized[field] = "[REDACTED]";
    const creds = sanitized["credentials"] as Record<string, unknown> | undefined;
    if (creds && creds[field]) {
      sanitized["credentials"] = { ...creds, [field]: "[REDACTED]" };
    }
    const agentCfg = sanitized["agentConfig"] as Record<string, unknown> | undefined;
    if (agentCfg?.apiKey) {
      sanitized["agentConfig"] = { ...agentCfg, apiKey: "[REDACTED]" };
    }
  }
  return sanitized;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    return next();
  }

  const start = Date.now();

  res.on("finish", () => {
    const action = `${req.method} ${req.path}`;
    const ipAddress =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const statusCode = res.statusCode;
    const severity = statusCode >= 500 ? "ERROR" : statusCode >= 400 ? "WARN" : "INFO";

    // Extract resource info from path
    const pathParts = req.path.split("/").filter(Boolean);
    const resourceType = pathParts[0] || null;
    const resourceId = pathParts[1] || null;

    db.insert(auditLogsTable)
      .values({
        action,
        resourceType,
        resourceId,
        ipAddress,
        userAgent: (req.headers["user-agent"] || "").slice(0, 500),
        severity,
        details: JSON.stringify({
          statusCode,
          durationMs: Date.now() - start,
          body: sanitizeBody(req.body),
        }),
      })
      .catch(() => {
        // Fire-and-forget — never block the response
      });
  });

  next();
}

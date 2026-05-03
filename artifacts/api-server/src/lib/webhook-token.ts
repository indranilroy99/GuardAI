/**
 * Webhook token management
 * Derives a deterministic, secure token from the session secret.
 * No DB storage needed — token is stable across restarts.
 */
import { createHmac } from "crypto";

const SALT = "sentinel-guardduty-webhook-v1";

/** Generate the webhook token from SESSION_SECRET. */
export function getWebhookToken(): string {
  const secret = process.env.SESSION_SECRET || "sentinel-dev-fallback-secret";
  return createHmac("sha256", secret).update(SALT).digest("hex");
}

/** Validate a candidate token using timing-safe comparison. */
export function validateWebhookToken(candidate: string): boolean {
  if (!candidate) return false;
  const expected = getWebhookToken();
  if (candidate.length !== expected.length) return false;
  // Timing-safe compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}

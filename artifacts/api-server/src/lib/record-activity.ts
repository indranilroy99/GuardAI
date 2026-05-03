import { db } from "@workspace/db";
import { alertActivityTable } from "@workspace/db";

export async function recordActivity(
  alertId: number,
  alertTitle: string,
  eventType: string,
  description: string,
  triggeredById: string,
  triggeredByName: string,
): Promise<void> {
  try {
    await db.insert(alertActivityTable).values({
      alertId,
      alertTitle,
      eventType,
      description,
      triggeredById,
      triggeredByName,
    });
  } catch {
    // Non-critical — never let this fail the main request
  }
}

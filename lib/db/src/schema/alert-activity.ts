import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { alertsTable } from "./alerts";

export const alertActivityTable = pgTable("alert_activity", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull().references(() => alertsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // "status_change" | "note_added" | "verdict_changed"
  description: text("description").notNull(),
  alertTitle: text("alert_title").notNull().default(""),
  triggeredById: text("triggered_by_id").notNull(),
  triggeredByName: text("triggered_by_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AlertActivity = typeof alertActivityTable.$inferSelect;

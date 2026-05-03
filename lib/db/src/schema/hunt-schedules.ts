import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scheduledHuntsTable = pgTable("scheduled_hunts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  schedule: text("schedule").notNull().default("daily"), // "hourly" | "daily" | "weekly"
  enabled: boolean("enabled").notNull().default(true),
  notifyWebhook: text("notify_webhook"),            // HTTP POST on new findings
  notifyEmail: text("notify_email"),                // placeholder for future SMTP
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at").notNull(),
  lastMatchCount: integer("last_match_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const huntNotificationsTable = pgTable("hunt_notifications", {
  id: serial("id").primaryKey(),
  scheduledHuntId: integer("scheduled_hunt_id").notNull(),
  huntName: text("hunt_name").notNull(),
  query: text("query").notNull(),
  findingsCount: integer("findings_count").notNull(),
  newFindingsCount: integer("new_findings_count").notNull(),
  summary: text("summary").notNull(),
  read: boolean("read").notNull().default(false),
  webhookSent: boolean("webhook_sent").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScheduledHuntSchema = createInsertSchema(scheduledHuntsTable).omit({
  id: true, createdAt: true, updatedAt: true, lastRunAt: true, lastMatchCount: true,
});
export type InsertScheduledHunt = z.infer<typeof insertScheduledHuntSchema>;
export type ScheduledHunt = typeof scheduledHuntsTable.$inferSelect;
export type HuntNotification = typeof huntNotificationsTable.$inferSelect;

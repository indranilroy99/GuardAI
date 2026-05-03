import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { alertsTable } from "./alerts";

export const alertWatchersTable = pgTable("alert_watchers", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull().references(() => alertsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AlertWatcher = typeof alertWatchersTable.$inferSelect;

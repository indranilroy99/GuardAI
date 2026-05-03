import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { alertsTable } from "./alerts";

export const alertNotesTable = pgTable("alert_notes", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull().references(() => alertsTable.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AlertNote = typeof alertNotesTable.$inferSelect;

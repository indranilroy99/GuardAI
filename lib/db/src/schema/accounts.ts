import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const awsAccountsTable = pgTable("aws_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  accountId: text("account_id").notNull().unique(),
  region: text("region").notNull().default("us-east-1"),
  environment: text("environment").notNull().default("production"),
  webhookToken: text("webhook_token"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAwsAccountSchema = createInsertSchema(awsAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAwsAccount = z.infer<typeof insertAwsAccountSchema>;
export type AwsAccount = typeof awsAccountsTable.$inferSelect;

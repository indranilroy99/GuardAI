import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const severityEnum = pgEnum("severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const resourceTypeEnum = pgEnum("resource_type", ["IAM_ROLE", "EC2_INSTANCE", "S3_BUCKET", "OTHER"]);
export const remediationStatusEnum = pgEnum("remediation_status", ["pending", "generated", "applied", "failed"]);

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  severity: severityEnum("severity").notNull(),
  type: text("type").notNull(),
  affectedResource: text("affected_resource").notNull(),
  resourceType: resourceTypeEnum("resource_type").notNull(),
  region: text("region").notNull(),
  accountId: text("account_id").notNull(),
  description: text("description").notNull(),
  mitreAttackTactic: text("mitre_attack_tactic").notNull(),
  mitreAttackTechnique: text("mitre_attack_technique").notNull(),
  mitreAttackTechniqueId: text("mitre_attack_technique_id").notNull(),
  mitreAttackMitigation: text("mitre_attack_mitigation").notNull(),
  remediationScript: text("remediation_script").notNull(),
  remediationStatus: remediationStatusEnum("remediation_status").notNull().default("generated"),
  rawAlert: text("raw_alert").notNull(),
  notes: text("notes"),
  // Multi-stage AI triage fields
  triageStatus: text("triage_status").notNull().default("idle"),
  triageStages: text("triage_stages"),
  verdict: text("verdict"),
  verdictConfidence: integer("verdict_confidence"),
  iocEnrichment: text("ioc_enrichment"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;

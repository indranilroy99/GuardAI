/**
 * Iterative AI Triage Agent
 *
 * Architecture:
 *   1. CONTEXTUALIZE   — Verify initial classification (always runs)
 *   2. IOC_ENRICHMENT  — Extract and enrich IOCs (always runs)
 *   3. INVESTIGATION LOOP — AI iterates, picking investigation tools until it
 *      has enough evidence to CONCLUDE. Each iteration is a new live stage.
 *      Available tools:
 *        behavioral_analysis   — Behavioral pattern & TTP analysis
 *        cloudtrail_simulation — Simulated CloudTrail event correlation
 *        lateral_movement      — Lateral movement path assessment
 *        data_exfiltration     — Data exposure / exfiltration analysis
 *        persistence_check     — Persistence mechanism detection
 *        network_analysis      — Network traffic & infrastructure analysis
 *        identity_analysis     — Deep IAM / identity investigation
 *      Loop continues until AI decides CONCLUDE or MAX_LOOP_ITERATIONS hit.
 *   4. VERDICT         — Final classification based on all accumulated evidence
 */

import { db, alertsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { enrichIocs, type IocEnrichmentResult } from "./ioc-enrichment.js";
import { broadcastSseEvent } from "./sse.js";

/**
 * AI provider selection.
 *
 * Set AI_PROVIDER=openrouter in your environment to use open-source models
 * (Llama, Mistral, etc.) via OpenRouter — no OpenAI key required.
 *
 * Set AI_MODEL to override the default model for the selected provider.
 *
 * Defaults:
 *   openai    → gpt-4o
 *   openrouter → meta-llama/llama-3.3-70b-instruct:free
 */
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
const AI_MODEL = process.env.AI_MODEL ?? (
  AI_PROVIDER === "openrouter" ? "meta-llama/llama-3.3-70b-instruct:free" : "gpt-4o"
);

function getAiClient() {
  return AI_PROVIDER === "openrouter" ? openrouter : openai;
}

export interface TriageStage {
  stage: number;
  name: string;
  kind: "fixed" | "loop" | "verdict";
  tool?: string;
  status: "running" | "complete" | "error";
  startedAt: string;
  completedAt?: string;
  summary: string;
  details: Record<string, unknown>;
  durationMs?: number;
}

export interface TriageVerdict {
  classification: "TRUE_POSITIVE" | "FALSE_POSITIVE" | "NEEDS_REVIEW";
  confidence: number;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
  reasoning: string;
  falsePositiveIndicators: string[];
  truePositiveIndicators: string[];
  recommendedActions: string[];
  estimatedImpact: string;
}

const TOOL_NAMES: Record<string, string> = {
  behavioral_analysis: "Behavioral Analysis",
  cloudtrail_simulation: "CloudTrail Correlation",
  lateral_movement: "Lateral Movement Assessment",
  data_exfiltration: "Data Exfiltration Analysis",
  persistence_check: "Persistence Detection",
  network_analysis: "Network Traffic Analysis",
  identity_analysis: "Identity & Access Investigation",
};

const MAX_LOOP_ITERATIONS = 6;

// ─── DB + SSE Helpers ────────────────────────────────────────────────────────

async function updateAlertTriage(
  alertId: number,
  patch: {
    triageStatus?: string;
    triageStages?: TriageStage[];
    verdict?: string;
    verdictConfidence?: number;
    iocEnrichment?: IocEnrichmentResult;
  },
): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.triageStatus !== undefined) values.triageStatus = patch.triageStatus;
  if (patch.triageStages !== undefined) values.triageStages = JSON.stringify(patch.triageStages);
  if (patch.verdict !== undefined) values.verdict = patch.verdict;
  if (patch.verdictConfidence !== undefined) values.verdictConfidence = patch.verdictConfidence;
  if (patch.iocEnrichment !== undefined) values.iocEnrichment = JSON.stringify(patch.iocEnrichment);
  await db.update(alertsTable).set(values as Record<string, unknown> & { updatedAt: Date }).where(eq(alertsTable.id, alertId));
}

function broadcast(alertId: number, stages: TriageStage[], extra?: Record<string, unknown>) {
  broadcastSseEvent("triage-update", { alertId, stages, ...extra });
}

async function aiCall(prompt: string, maxTokens = 1500): Promise<string> {
  const client = getAiClient();
  // OpenRouter open models don't always support response_format: json_object
  // so we instruct via system prompt instead and parse defensively
  const useJsonMode = AI_PROVIDER !== "openrouter";
  const resp = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      ...(useJsonMode ? [] : [{ role: "system" as const, content: "Always respond with valid JSON only. No markdown, no explanation. Just a raw JSON object." }]),
      { role: "user" as const, content: prompt },
    ],
  });
  const content = resp.choices[0]?.message?.content ?? "{}";
  // Strip markdown code fences if open model wraps output
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function pushStage(stages: TriageStage[], partial: Omit<TriageStage, "stage">): TriageStage[] {
  const stage = stages.length + 1;
  stages.push({ stage, ...partial });
  return stages;
}

function completeStage(stages: TriageStage[], start: number, summary: string, details: Record<string, unknown>): TriageStage[] {
  const idx = stages.length - 1;
  stages[idx] = {
    ...stages[idx]!,
    status: "complete",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    summary,
    details,
  };
  return stages;
}

function errorStage(stages: TriageStage[], err: unknown): TriageStage[] {
  const idx = stages.length - 1;
  stages[idx] = {
    ...stages[idx]!,
    status: "error",
    completedAt: new Date().toISOString(),
    summary: "Stage failed",
    details: { error: String(err) },
  };
  return stages;
}

// ─── Fixed Stage 1: Contextualize ────────────────────────────────────────────

async function runStage1(
  alertId: number,
  rawAlert: string,
  analysis: Record<string, string>,
  stages: TriageStage[],
): Promise<{ contextSummary: string }> {
  const start = Date.now();
  pushStage(stages, {
    kind: "fixed",
    name: "Contextualize & Verify",
    status: "running",
    startedAt: new Date().toISOString(),
    summary: "Verifying initial AI classification…",
    details: {},
  });
  await updateAlertTriage(alertId, { triageStatus: "running", triageStages: stages });
  broadcast(alertId, stages);

  try {
    const content = await aiCall(`You are a senior SOC analyst performing first-pass verification of a GuardDuty finding.

Initial classification:
- Title: ${analysis.title}
- Severity: ${analysis.severity}
- Type: ${analysis.type}
- Resource: ${analysis.affectedResource} (${analysis.resourceType})
- MITRE: ${analysis.mitreAttackTactic} / ${analysis.mitreAttackTechnique} (${analysis.mitreAttackTechniqueId})

Raw finding (truncated to 2000 chars):
${rawAlert.slice(0, 2000)}

Respond with JSON:
{
  "classificationAccurate": boolean,
  "severityAdjustment": "none"|"increase"|"decrease",
  "adjustedSeverity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "contextNotes": string,
  "riskFactors": string[],
  "initialConfidenceEstimate": number,
  "investigationPriority": "high"|"medium"|"low",
  "summary": string
}`);

    const result = JSON.parse(content) as Record<string, unknown>;
    completeStage(stages, start, String(result.summary ?? "Initial classification verified"), result);
    await updateAlertTriage(alertId, { triageStages: stages });
    broadcast(alertId, stages);
    return { contextSummary: String(result.summary) };
  } catch (err) {
    errorStage(stages, err);
    await updateAlertTriage(alertId, { triageStages: stages });
    broadcast(alertId, stages);
    return { contextSummary: "Verification failed" };
  }
}

// ─── Fixed Stage 2: IOC Enrichment ───────────────────────────────────────────

async function runStage2(
  alertId: number,
  rawAlert: string,
  stages: TriageStage[],
): Promise<{ ioc: IocEnrichmentResult | null; iocSummary: string }> {
  const start = Date.now();
  pushStage(stages, {
    kind: "fixed",
    name: "IOC Enrichment",
    status: "running",
    startedAt: new Date().toISOString(),
    summary: "Extracting & enriching indicators of compromise…",
    details: {},
  });
  await updateAlertTriage(alertId, { triageStages: stages });
  broadcast(alertId, stages);

  try {
    const ioc = await enrichIocs(rawAlert);
    const aiContent = await aiCall(`You are a threat intelligence analyst interpreting IOC enrichment results.

IOC data:
${JSON.stringify(ioc, null, 2)}

Finding context (truncated):
${rawAlert.slice(0, 800)}

Respond with JSON:
{
  "threatActorProfile": string,
  "geographicRisk": "none"|"low"|"medium"|"high",
  "infrastructureType": string,
  "knownCampaignAssociation": string|null,
  "iocSeverityImpact": "none"|"low"|"medium"|"high",
  "summary": string
}`);

    const aiResult = JSON.parse(aiContent) as Record<string, unknown>;
    const summary = ioc.summary + (aiResult.threatActorProfile ? ` | ${aiResult.threatActorProfile}` : "");
    completeStage(stages, start, summary, { ...ioc, aiInterpretation: aiResult });
    await updateAlertTriage(alertId, { triageStages: stages, iocEnrichment: ioc });
    broadcast(alertId, stages);
    return { ioc, iocSummary: summary };
  } catch (err) {
    errorStage(stages, err);
    await updateAlertTriage(alertId, { triageStages: stages });
    broadcast(alertId, stages);
    return { ioc: null, iocSummary: "IOC enrichment failed" };
  }
}

// ─── Investigation Loop Tools ─────────────────────────────────────────────────

async function runInvestigationTool(
  tool: string,
  rawAlert: string,
  analysis: Record<string, string>,
  evidenceSoFar: string,
  iocSummary: string,
): Promise<{ summary: string; details: Record<string, unknown> }> {
  const base = `Previous investigation evidence:
${evidenceSoFar}

Finding: ${analysis.type} | Severity: ${analysis.severity} | Resource: ${analysis.affectedResource}
IOC context: ${iocSummary}
Raw finding (truncated): ${rawAlert.slice(0, 1200)}`;

  if (tool === "behavioral_analysis") {
    const c = await aiCall(`${base}

You are a behavioral threat analyst. Analyze this finding for behavioral patterns.
Respond with JSON:
{
  "anomalyScore": number (0-100),
  "timeOfDayRisk": "normal"|"off-hours"|"unusual",
  "frequencyPattern": string,
  "legitimateUseCases": string[],
  "maliciousUseCases": string[],
  "ttpAlignment": string,
  "baselineDeviation": string,
  "behavioralVerdict": "likely_benign"|"suspicious"|"likely_malicious",
  "confidenceContribution": number (0-100, how much does this add to overall confidence),
  "summary": string
}`, 1200);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  if (tool === "cloudtrail_simulation") {
    const c = await aiCall(`${base}

You are a cloud forensics investigator. Simulate what CloudTrail investigation would reveal.
Respond with JSON:
{
  "simulatedApiCallSequence": string[],
  "suspiciousApiCalls": string[],
  "timelineReconstruction": string[],
  "rootCauseHypothesis": string,
  "correlatedResources": string[],
  "confidenceContribution": number (0-100),
  "summary": string
}`, 1500);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  if (tool === "lateral_movement") {
    const c = await aiCall(`${base}

You are a threat hunter analyzing lateral movement potential.
Respond with JSON:
{
  "lateralMovementPaths": string[],
  "compromisedEntities": string[],
  "pivotPoints": string[],
  "blastRadius": string,
  "attackProgressionStage": string,
  "confidenceContribution": number (0-100),
  "summary": string
}`, 1200);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  if (tool === "data_exfiltration") {
    const c = await aiCall(`${base}

You are a data security analyst assessing data exposure risk.
Respond with JSON:
{
  "dataAtRisk": string[],
  "exfiltrationLikelihood": "none"|"low"|"medium"|"high",
  "estimatedDataVolume": string,
  "affectedDataClassification": string,
  "regulatoryImplications": string[],
  "confidenceContribution": number (0-100),
  "summary": string
}`, 1200);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  if (tool === "persistence_check") {
    const c = await aiCall(`${base}

You are a malware analyst checking for persistence mechanisms.
Respond with JSON:
{
  "persistenceMechanisms": string[],
  "backdoorIndicators": string[],
  "scheduledTasksRisk": string,
  "credentialHarvestingEvidence": string,
  "cleanupDifficulty": "easy"|"moderate"|"difficult"|"very_difficult",
  "confidenceContribution": number (0-100),
  "summary": string
}`, 1200);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  if (tool === "network_analysis") {
    const c = await aiCall(`${base}

You are a network security analyst examining network indicators.
Respond with JSON:
{
  "suspiciousConnections": string[],
  "c2Indicators": string[],
  "encryptedChannelEvidence": string,
  "beaconingPattern": string,
  "networkExposureRisk": "none"|"low"|"medium"|"high",
  "confidenceContribution": number (0-100),
  "summary": string
}`, 1200);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  if (tool === "identity_analysis") {
    const c = await aiCall(`${base}

You are an IAM security specialist analyzing identity and access patterns.
Respond with JSON:
{
  "compromisedIdentityLikelihood": "none"|"low"|"medium"|"high",
  "privilegeEscalationEvidence": string[],
  "unusualAccessPatterns": string[],
  "mfaStatus": string,
  "credentialAge": string,
  "iamRiskScore": number (0-100),
  "confidenceContribution": number (0-100),
  "summary": string
}`, 1200);
    const r = JSON.parse(c) as Record<string, unknown>;
    return { summary: String(r.summary), details: r };
  }

  return { summary: "Unknown tool", details: {} };
}

// ─── Agent Decision: Continue or Conclude? ────────────────────────────────────

interface AgentDecision {
  action: "INVESTIGATE" | "CONCLUDE";
  tool?: string;
  reason: string;
  currentConfidenceEstimate: number;
}

async function askAgentNextAction(
  rawAlert: string,
  analysis: Record<string, string>,
  evidenceSoFar: string,
  toolsUsed: string[],
  iterationCount: number,
): Promise<AgentDecision> {
  const availableTools = Object.keys(TOOL_NAMES).filter((t) => !toolsUsed.includes(t));
  const forceConclusion = iterationCount >= MAX_LOOP_ITERATIONS || availableTools.length === 0;

  if (forceConclusion) {
    return {
      action: "CONCLUDE",
      reason: iterationCount >= MAX_LOOP_ITERATIONS
        ? "Maximum investigation iterations reached"
        : "All available investigation tools exhausted",
      currentConfidenceEstimate: 75,
    };
  }

  const c = await aiCall(`You are the lead SOC investigator managing an iterative security investigation. 
You decide whether to continue investigating or conclude with a verdict.

Finding: ${analysis.type} | Severity: ${analysis.severity}
Investigation so far (${iterationCount} iteration${iterationCount !== 1 ? "s" : ""}):
${evidenceSoFar || "No iterations completed yet"}

Available investigation tools (not yet used):
${availableTools.map((t) => `- ${t}: ${TOOL_NAMES[t]}`).join("\n")}

Rules:
- CONCLUDE if confidence estimate >= 85% OR if further investigation won't meaningfully change the verdict
- INVESTIGATE if key questions remain unanswered OR confidence < 85%
- Never use a tool twice

Respond with JSON:
{
  "action": "INVESTIGATE"|"CONCLUDE",
  "tool": "${availableTools.join('"|"')}" (only if action=INVESTIGATE),
  "reason": string (why this action),
  "currentConfidenceEstimate": number (0-100, your current confidence in any verdict)
}`, 600);

  try {
    return JSON.parse(c) as AgentDecision;
  } catch {
    return { action: "CONCLUDE", reason: "Parse error", currentConfidenceEstimate: 60 };
  }
}

// ─── Fixed Final Stage: Verdict ───────────────────────────────────────────────

async function runVerdictStage(
  alertId: number,
  rawAlert: string,
  analysis: Record<string, string>,
  stages: TriageStage[],
): Promise<TriageVerdict> {
  const start = Date.now();
  pushStage(stages, {
    kind: "verdict",
    name: "Verdict",
    status: "running",
    startedAt: new Date().toISOString(),
    summary: "Synthesizing all evidence — computing final verdict…",
    details: {},
  });
  await updateAlertTriage(alertId, { triageStages: stages });
  broadcast(alertId, stages);

  const allEvidence = stages
    .filter((s) => s.status === "complete")
    .map((s) => `[${s.name}]: ${s.summary}`)
    .join("\n");

  try {
    const content = await aiCall(`You are the lead threat analyst making a final verdict after a thorough iterative investigation.

All investigation evidence (${stages.filter((s) => s.kind === "loop").length} deep-dive iterations):
${allEvidence}

Original finding:
- Type: ${analysis.type}
- Severity: ${analysis.severity}
- Resource: ${analysis.affectedResource} (${analysis.resourceType})
- Account: ${analysis.accountId} | Region: ${analysis.region}

Synthesize all evidence and produce a definitive verdict. Respond with JSON:
{
  "classification": "TRUE_POSITIVE"|"FALSE_POSITIVE"|"NEEDS_REVIEW",
  "confidence": number (0-100),
  "priority": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFORMATIONAL",
  "reasoning": string (3-4 sentences synthesizing the full investigation),
  "falsePositiveIndicators": string[],
  "truePositiveIndicators": string[],
  "recommendedActions": string[] (4-6 specific, actionable remediation steps),
  "estimatedImpact": string
}`, 1800);

    const result = JSON.parse(content) as TriageVerdict;
    const verdictLabel = `${result.classification.replace("_", " ")} — ${result.confidence}% confidence`;
    completeStage(stages, start, verdictLabel, result as unknown as Record<string, unknown>);

    await updateAlertTriage(alertId, {
      triageStatus: "complete",
      triageStages: stages,
      verdict: result.classification,
      verdictConfidence: result.confidence,
    });

    broadcastSseEvent("triage-complete", {
      alertId,
      stages,
      verdict: result.classification,
      verdictConfidence: result.confidence,
      priority: result.priority,
      recommendedActions: result.recommendedActions,
    });

    return result;
  } catch (err) {
    errorStage(stages, err);
    await updateAlertTriage(alertId, { triageStatus: "error", triageStages: stages });
    broadcast(alertId, stages);
    return {
      classification: "NEEDS_REVIEW",
      confidence: 0,
      priority: "MEDIUM",
      reasoning: "Verdict computation failed. Manual review required.",
      falsePositiveIndicators: [],
      truePositiveIndicators: [],
      recommendedActions: ["Review the finding manually"],
      estimatedImpact: "Unknown",
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the iterative AI triage agent for an alert.
 * Stages 1 & 2 are fixed. Stage 3+ iterate until the AI concludes.
 * Call without awaiting from route handlers — runs fully in background.
 */
export async function runTriageAgent(
  alertId: number,
  rawAlert: string,
  initialAnalysis: Record<string, string>,
): Promise<void> {
  const stages: TriageStage[] = [];

  try {
    broadcastSseEvent("triage-started", { alertId });

    // Fixed stage 1: Contextualize
    await runStage1(alertId, rawAlert, initialAnalysis, stages);

    // Fixed stage 2: IOC Enrichment
    const { iocSummary } = await runStage2(alertId, rawAlert, stages);

    // Iterative investigation loop
    const toolsUsed: string[] = [];
    let iterationCount = 0;

    while (true) {
      const evidenceSoFar = stages
        .filter((s) => s.status === "complete")
        .map((s) => `[${s.name}]: ${s.summary}`)
        .join("\n");

      const decision = await askAgentNextAction(
        rawAlert,
        initialAnalysis,
        evidenceSoFar,
        toolsUsed,
        iterationCount,
      );

      if (decision.action === "CONCLUDE") break;

      const tool = decision.tool ?? "";
      if (!tool || !TOOL_NAMES[tool]) break;

      toolsUsed.push(tool);
      iterationCount++;

      const toolName = TOOL_NAMES[tool]!;
      const start = Date.now();

      pushStage(stages, {
        kind: "loop",
        name: toolName,
        tool,
        status: "running",
        startedAt: new Date().toISOString(),
        summary: `${decision.reason}`,
        details: { agentReason: decision.reason, confidenceBeforeStage: decision.currentConfidenceEstimate },
      });
      await updateAlertTriage(alertId, { triageStages: stages });
      broadcast(alertId, stages);

      try {
        const updatedEvidence = stages
          .filter((s) => s.status === "complete")
          .map((s) => `[${s.name}]: ${s.summary}`)
          .join("\n");

        const { summary, details } = await runInvestigationTool(
          tool,
          rawAlert,
          initialAnalysis,
          updatedEvidence,
          iocSummary,
        );

        completeStage(stages, start, summary, { ...details, agentReason: decision.reason });
        await updateAlertTriage(alertId, { triageStages: stages });
        broadcast(alertId, stages);
      } catch (err) {
        errorStage(stages, err);
        await updateAlertTriage(alertId, { triageStages: stages });
        broadcast(alertId, stages);
      }
    }

    // Final verdict
    await runVerdictStage(alertId, rawAlert, initialAnalysis, stages);
  } catch (err) {
    await updateAlertTriage(alertId, { triageStatus: "error" });
    broadcastSseEvent("triage-error", { alertId, error: String(err) });
  }
}

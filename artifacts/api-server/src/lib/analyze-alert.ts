import { openai } from "@workspace/integrations-openai-ai-server";

export interface AnalysisResult {
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  type: string;
  affectedResource: string;
  resourceType: "IAM_ROLE" | "EC2_INSTANCE" | "S3_BUCKET" | "OTHER";
  region: string;
  accountId: string;
  description: string;
  mitreAttackTactic: string;
  mitreAttackTechnique: string;
  mitreAttackTechniqueId: string;
  mitreAttackMitigation: string;
  remediationScript: string;
}

export async function analyzeGuardDutyAlert(alertJson: string): Promise<AnalysisResult> {
  let parsedAlert: unknown;
  try {
    parsedAlert = JSON.parse(alertJson);
  } catch {
    throw new Error("Invalid JSON provided for GuardDuty alert");
  }

  const prompt = `You are an AWS security expert. Analyze the following AWS GuardDuty alert JSON and respond with a JSON object containing:

1. title: A clear, concise title for this security finding
2. severity: One of LOW, MEDIUM, HIGH, CRITICAL (based on the GuardDuty severity score: 1-3.9=LOW, 4-6.9=MEDIUM, 7-8.9=HIGH, 9-10=CRITICAL)
3. type: The GuardDuty finding type
4. affectedResource: The specific affected resource identifier (ARN, instance ID, role name, etc.)
5. resourceType: One of IAM_ROLE, EC2_INSTANCE, S3_BUCKET, OTHER
6. region: AWS region
7. accountId: AWS account ID
8. description: A clear explanation of what this alert means and why it's dangerous
9. mitreAttackTactic: The relevant MITRE ATT&CK tactic (e.g., "Initial Access", "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access", "Discovery", "Lateral Movement", "Collection", "Command and Control", "Exfiltration", "Impact")
10. mitreAttackTechnique: The specific MITRE ATT&CK technique name
11. mitreAttackTechniqueId: The MITRE ATT&CK technique ID (e.g., T1078, T1190)
12. mitreAttackMitigation: Specific MITRE ATT&CK mitigation recommendations
13. remediationScript: A complete, working Python script using boto3 that quarantines the affected resource. For IAM roles: detach all policies, add a deny-all inline policy, and optionally disable access keys. For EC2 instances: create an isolation security group with no inbound/outbound rules and attach it, stop the instance. The script should include error handling, comments, and be production-ready.

GuardDuty Alert:
${JSON.stringify(parsedAlert, null, 2)}

Respond ONLY with a valid JSON object, no markdown, no explanation.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(content) as AnalysisResult;

  const validSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
  const validResourceTypes = ["IAM_ROLE", "EC2_INSTANCE", "S3_BUCKET", "OTHER"] as const;

  if (!validSeverities.includes(result.severity)) result.severity = "MEDIUM";
  if (!validResourceTypes.includes(result.resourceType)) result.resourceType = "OTHER";

  return result;
}

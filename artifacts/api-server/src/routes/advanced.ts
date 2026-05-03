import { Router } from "express";
import {
  IAMClient,
  GetRoleCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
  GetPolicyVersionCommand,
  GetPolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CloudTrailClient,
  LookupEventsCommand,
  LookupAttributeKey,
} from "@aws-sdk/client-cloudtrail";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

function makeAwsConfig(creds: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}) {
  return {
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
    },
  };
}

// ─── POST /aws/blast-radius ────────────────────────────────────────────────
router.post("/aws/blast-radius", async (req, res) => {
  try {
    const { credentials, resourceId, resourceType } = req.body as {
      credentials: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
        region: string;
      };
      resourceId: string;
      resourceType: string;
    };

    if (!credentials?.accessKeyId || !resourceId || !resourceType) {
      res.status(400).json({ error: "credentials, resourceId, and resourceType are required" });
      return;
    }

    const awsConfig = makeAwsConfig(credentials);
    const iamClient = new IAMClient(awsConfig);

    // Collect policy documents for the resource
    const rawPolicies: string[] = [];
    let policyContextStr = "";

    if (resourceType === "IAM_ROLE") {
      // Get role details
      try {
        const roleRes = await iamClient.send(new GetRoleCommand({ RoleName: resourceId }));
        if (roleRes.Role?.AssumeRolePolicyDocument) {
          rawPolicies.push(decodeURIComponent(roleRes.Role.AssumeRolePolicyDocument));
        }
      } catch {}

      // Get attached managed policies
      try {
        const attached = await iamClient.send(
          new ListAttachedRolePoliciesCommand({ RoleName: resourceId })
        );
        for (const policy of attached.AttachedPolicies || []) {
          try {
            const policyData = await iamClient.send(
              new GetPolicyCommand({ PolicyArn: policy.PolicyArn! })
            );
            const versionId = policyData.Policy?.DefaultVersionId;
            if (versionId) {
              const versionData = await iamClient.send(
                new GetPolicyVersionCommand({
                  PolicyArn: policy.PolicyArn!,
                  VersionId: versionId,
                })
              );
              if (versionData.PolicyVersion?.Document) {
                rawPolicies.push(
                  `[${policy.PolicyName}]: ${decodeURIComponent(versionData.PolicyVersion.Document)}`
                );
              }
            }
          } catch {}
        }
      } catch {}

      // Get inline policies
      try {
        const inline = await iamClient.send(
          new ListRolePoliciesCommand({ RoleName: resourceId })
        );
        for (const policyName of inline.PolicyNames || []) {
          try {
            const policyData = await iamClient.send(
              new GetRolePolicyCommand({ RoleName: resourceId, PolicyName: policyName })
            );
            if (policyData.PolicyDocument) {
              rawPolicies.push(
                `[inline:${policyName}]: ${decodeURIComponent(policyData.PolicyDocument)}`
              );
            }
          } catch {}
        }
      } catch {}

      policyContextStr = rawPolicies.join("\n\n").slice(0, 8000);
    }

    // Use AI to assess blast radius from the policies
    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a cloud security expert analyzing the blast radius of a compromised AWS ${resourceType}.
Analyze the provided IAM policies and return a JSON object with:
- score: integer 0-100 (0=no risk, 100=full account takeover potential)
- summary: string (2-3 sentence executive summary)
- accessibleServices: array of { service: string, actions: string[], resources: string[], riskLevel: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL" }
- monetaryImpact: string (e.g. "Attacker can spawn unlimited EC2 instances, potential for $50k+/day in compute costs")
- dataAtRisk: string[] (S3 buckets, DynamoDB tables, RDS instances potentially accessible)
- lateralMovementPaths: string[] (how attacker can expand access from this resource)
If no policy data is provided, make reasonable assumptions for the resource type and note they are estimates.`,
        },
        {
          role: "user",
          content: `Resource: ${resourceType} "${resourceId}"\n\nPolicy documents:\n${policyContextStr || "(no policy data retrieved — using resource type heuristics)"}`,
        },
      ],
    });

    let result: {
      score: number;
      summary: string;
      accessibleServices: Array<{ service: string; actions: string[]; resources: string[]; riskLevel: string }>;
      monetaryImpact: string;
      dataAtRisk: string[];
      lateralMovementPaths: string[];
    } = {
      score: 50,
      summary: "Blast radius analysis unavailable.",
      accessibleServices: [],
      monetaryImpact: "Unknown",
      dataAtRisk: [],
      lateralMovementPaths: [],
    };

    try {
      result = JSON.parse(aiRes.choices[0]?.message?.content || "{}");
    } catch {}

    res.json({
      resourceId,
      score: result.score ?? 50,
      summary: result.summary ?? "",
      accessibleServices: result.accessibleServices ?? [],
      monetaryImpact: result.monetaryImpact ?? "Unknown",
      dataAtRisk: result.dataAtRisk ?? [],
      lateralMovementPaths: result.lateralMovementPaths ?? [],
      rawPolicies,
    });
  } catch (err) {
    req.log.error({ err }, "Blast radius calculation failed");
    res.status(500).json({ error: "Blast radius calculation failed" });
  }
});

// ─── POST /aws/kill-chain ────────────────────────────────────────────────────
router.post("/aws/kill-chain", async (req, res) => {
  try {
    const { credentials, resourceId, resourceType } = req.body as {
      credentials: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
        region: string;
      };
      resourceId: string;
      resourceType: string;
      alertId?: number;
    };

    if (!credentials?.accessKeyId || !resourceId || !resourceType) {
      res.status(400).json({ error: "credentials, resourceId, and resourceType are required" });
      return;
    }

    const awsConfig = makeAwsConfig(credentials);
    const trailClient = new CloudTrailClient(awsConfig);

    // Fetch CloudTrail events for the last 7 days related to this resource
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events: Array<{ time?: Date; name?: string; source?: string; id?: string; resources?: unknown }> = [];

    try {
      const trailRes = await trailClient.send(
        new LookupEventsCommand({
          LookupAttributes: [
            {
              AttributeKey: LookupAttributeKey.RESOURCE_NAME,
              AttributeValue: resourceId,
            },
          ],
          StartTime: sevenDaysAgo,
          MaxResults: 50,
        })
      );
      for (const e of trailRes.Events || []) {
        events.push({
          time: e.EventTime,
          name: e.EventName,
          source: e.EventSource,
          id: e.EventId,
          resources: e.Resources,
        });
      }
    } catch {
      // CloudTrail might not be enabled or accessible — proceed with AI-only analysis
    }

    const eventsStr = events.length > 0
      ? events.map(e =>
          `[${e.time?.toISOString() || "?"}] ${e.source}:${e.name}`
        ).join("\n").slice(0, 4000)
      : "(no CloudTrail events retrieved — using GuardDuty finding context only)";

    // Use AI to map events to MITRE kill chain stages
    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a threat intelligence analyst reconstructing an attack kill chain for a compromised AWS ${resourceType}.
Map observed events (or infer from context) to MITRE ATT&CK stages and return JSON:
- summary: string (2-3 sentence attack narrative)
- confidence: integer 0-100 (confidence in reconstruction)
- durationMinutes: integer (estimated attack duration)
- attackerProfile: string (e.g. "Automated credential scanner, likely financially motivated")
- stages: array of {
    stage: string (e.g. "Initial Access", "Persistence", "Privilege Escalation"),
    mitreTactic: string (MITRE tactic name),
    mitreId: string (e.g. "T1078"),
    timestamp: string (ISO or relative, null if unknown),
    events: string[] (2-4 observed events or inferred activities),
    narrative: string (1-2 sentences describing what happened),
    indicator: string (IoC or key observable)
  }
- recommendations: string[] (5 immediate response actions)
Order stages chronologically. Include only stages that are evidenced or highly probable.`,
        },
        {
          role: "user",
          content: `Compromised resource: ${resourceType} "${resourceId}"\n\nCloudTrail events (7 days):\n${eventsStr}`,
        },
      ],
    });

    let result: {
      summary: string;
      confidence: number;
      durationMinutes: number;
      attackerProfile: string;
      stages: Array<{
        stage: string;
        mitreTactic: string;
        mitreId: string;
        timestamp: string;
        events: string[];
        narrative: string;
        indicator: string;
      }>;
      recommendations: string[];
    } = {
      summary: "Kill chain reconstruction unavailable.",
      confidence: 0,
      durationMinutes: 0,
      attackerProfile: "Unknown",
      stages: [],
      recommendations: [],
    };

    try {
      result = JSON.parse(aiRes.choices[0]?.message?.content || "{}");
    } catch {}

    res.json({
      summary: result.summary ?? "",
      confidence: result.confidence ?? 0,
      durationMinutes: result.durationMinutes ?? 0,
      attackerProfile: result.attackerProfile ?? "Unknown",
      stages: result.stages ?? [],
      recommendations: result.recommendations ?? [],
    });
  } catch (err) {
    req.log.error({ err }, "Kill chain reconstruction failed");
    res.status(500).json({ error: "Kill chain reconstruction failed" });
  }
});

export default router;

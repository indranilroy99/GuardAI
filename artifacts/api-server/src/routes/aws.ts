import { Router } from "express";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  GuardDutyClient,
  ListDetectorsCommand,
  ListFindingsCommand,
  GetFindingsCommand,
} from "@aws-sdk/client-guardduty";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";
import {
  IAMClient,
  GetRoleCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CloudTrailClient,
  LookupEventsCommand,
  LookupAttributeKey,
} from "@aws-sdk/client-cloudtrail";
import {
  TestAwsConnectionBody,
  FetchAwsFindingsBody,
  FetchResourceDetailsBody,
  InvestigateFindingBody,
  ImportAndAnalyzeFindingBody,
} from "@workspace/api-zod";
import { db, alertsTable } from "@workspace/db";
import { analyzeGuardDutyAlert } from "../lib/analyze-alert.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import { eq } from "drizzle-orm";

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

function severityNumToLabel(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 9) return "CRITICAL";
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  return "LOW";
}

function extractResourceFromFinding(finding: any): {
  resourceType: string;
  affectedResource: string;
} {
  const resource = finding.Resource || {};
  const type = resource.ResourceType || "OTHER";

  if (type === "Instance" || resource.InstanceDetails) {
    return {
      resourceType: "EC2_INSTANCE",
      affectedResource:
        resource.InstanceDetails?.InstanceId ||
        resource.InstanceDetails?.InstanceArn ||
        "unknown-instance",
    };
  }
  if (type === "AccessKey" || resource.AccessKeyDetails) {
    const roleName =
      resource.AccessKeyDetails?.UserName ||
      resource.AccessKeyDetails?.PrincipalId ||
      "unknown-role";
    return { resourceType: "IAM_ROLE", affectedResource: roleName };
  }
  if (type === "S3Bucket" || resource.S3BucketDetails) {
    const bucket = Array.isArray(resource.S3BucketDetails)
      ? resource.S3BucketDetails[0]?.Name
      : resource.S3BucketDetails?.Name;
    return { resourceType: "S3_BUCKET", affectedResource: bucket || "unknown-bucket" };
  }
  if (type === "IAMUser" || resource.IamInstanceProfile) {
    return {
      resourceType: "IAM_ROLE",
      affectedResource:
        resource.IamInstanceProfile?.Arn || resource.IamInstanceProfile?.Id || "unknown-iam",
    };
  }
  return { resourceType: "OTHER", affectedResource: JSON.stringify(resource).slice(0, 100) };
}

// POST /api/aws/test-connection
router.post("/aws/test-connection", async (req, res) => {
  const parsed = TestAwsConnectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid credentials payload" });
    return;
  }
  const creds = parsed.data;
  const cfg = makeAwsConfig(creds);

  try {
    const sts = new STSClient(cfg);
    const identity = await sts.send(new GetCallerIdentityCommand({}));

    const gd = new GuardDutyClient(cfg);
    let detectorId: string | undefined;
    let guardDutyEnabled = false;
    try {
      const detectors = await gd.send(new ListDetectorsCommand({}));
      if (detectors.DetectorIds && detectors.DetectorIds.length > 0) {
        detectorId = detectors.DetectorIds[0];
        guardDutyEnabled = true;
      }
    } catch {
      // GuardDuty might not be enabled
    }

    res.json({
      success: true,
      accountId: identity.Account,
      userId: identity.UserId,
      arn: identity.Arn,
      detectorId,
      guardDutyEnabled,
    });
  } catch (err: any) {
    req.log.error({ err }, "AWS connection test failed");
    res.json({
      success: false,
      guardDutyEnabled: false,
      error: err?.message || "Connection failed",
    });
  }
});

// POST /api/aws/findings
router.post("/aws/findings", async (req, res) => {
  const parsed = FetchAwsFindingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { credentials, maxResults = 50, severityMin = 1 } = parsed.data;
  const cfg = makeAwsConfig(credentials);

  try {
    const gd = new GuardDutyClient(cfg);

    // Get detector ID
    const detectors = await gd.send(new ListDetectorsCommand({}));
    if (!detectors.DetectorIds || detectors.DetectorIds.length === 0) {
      res.json([]);
      return;
    }
    const detectorId = detectors.DetectorIds[0]!;

    // List findings with severity filter
    const listResp = await gd.send(
      new ListFindingsCommand({
        DetectorId: detectorId,
        FindingCriteria: {
          Criterion: {
            severity: {
              Gte: severityMin,
            },
          },
        },
        MaxResults: maxResults,
        SortCriteria: { AttributeName: "updatedAt", OrderBy: "DESC" },
      })
    );

    const findingIds = listResp.FindingIds || [];
    if (findingIds.length === 0) {
      res.json([]);
      return;
    }

    // Get finding details in batches of 50
    const chunks: string[][] = [];
    for (let i = 0; i < findingIds.length; i += 50) {
      chunks.push(findingIds.slice(i, i + 50));
    }

    const allFindings: any[] = [];
    for (const chunk of chunks) {
      const details = await gd.send(
        new GetFindingsCommand({ DetectorId: detectorId, FindingIds: chunk })
      );
      allFindings.push(...(details.Findings || []));
    }

    // Check which findings are already imported
    const importedAlerts = await db.select({ rawAlert: alertsTable.rawAlert }).from(alertsTable);
    const importedFindingIds = new Set<string>();
    for (const a of importedAlerts) {
      try {
        const parsed = JSON.parse(a.rawAlert);
        if (parsed.Id || parsed.id) importedFindingIds.add(parsed.Id || parsed.id);
      } catch {}
    }

    const results = allFindings.map((f: any) => {
      const { resourceType, affectedResource } = extractResourceFromFinding(f);
      return {
        id: f.Id,
        type: f.Type,
        severity: f.Severity,
        title: f.Title,
        description: f.Description,
        region: credentials.region,
        accountId: f.AccountId,
        resourceType,
        affectedResource,
        createdAt: new Date(f.CreatedAt).toISOString(),
        updatedAt: new Date(f.UpdatedAt).toISOString(),
        rawJson: JSON.stringify(f),
        alreadyImported: importedFindingIds.has(f.Id),
      };
    });

    res.json(results);
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch GuardDuty findings");
    res.status(500).json({ error: err?.message || "Failed to fetch findings" });
  }
});

// POST /api/aws/resource-details
router.post("/aws/resource-details", async (req, res) => {
  const parsed = FetchResourceDetailsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { credentials, resourceType, resourceId } = parsed.data;
  const cfg = makeAwsConfig(credentials);

  try {
    if (resourceType === "EC2_INSTANCE") {
      const ec2 = new EC2Client(cfg);
      const resp = await ec2.send(
        new DescribeInstancesCommand({ InstanceIds: [resourceId] })
      );
      const instance = resp.Reservations?.[0]?.Instances?.[0];
      if (!instance) {
        res.status(404).json({ error: "Instance not found" });
        return;
      }

      const sgIds = instance.SecurityGroups?.map((sg) => sg.GroupId || "") || [];
      let sgNames: string[] = [];
      if (sgIds.length > 0) {
        try {
          const sgResp = await ec2.send(
            new DescribeSecurityGroupsCommand({ GroupIds: sgIds })
          );
          sgNames =
            sgResp.SecurityGroups?.map((sg) => `${sg.GroupName} (${sg.GroupId})`) || [];
        } catch {}
      }

      res.json({
        resourceType: "EC2_INSTANCE",
        resourceId,
        name:
          instance.Tags?.find((t) => t.Key === "Name")?.Value || instance.InstanceId || resourceId,
        state: instance.State?.Name || "unknown",
        createdAt: instance.LaunchTime?.toISOString(),
        tags:
          instance.Tags?.map((t) => ({ key: t.Key || "", value: t.Value || "" })) || [],
        attributes: {
          instanceType: instance.InstanceType || "",
          imageId: instance.ImageId || "",
          keyName: instance.KeyName || "",
          architecture: instance.Architecture || "",
          platform: instance.Platform || "linux",
          iamProfile: instance.IamInstanceProfile?.Arn || "",
        },
        networkInfo: {
          vpcId: instance.VpcId || "",
          subnetId: instance.SubnetId || "",
          privateIp: instance.PrivateIpAddress || "",
          publicIp: instance.PublicIpAddress || "",
          securityGroups: sgNames,
        },
      });
    } else if (resourceType === "IAM_ROLE") {
      const iam = new IAMClient(cfg);

      // Extract role name from ARN if needed
      const roleName = resourceId.includes("arn:aws:iam::")
        ? resourceId.split("/").pop() || resourceId
        : resourceId;

      const roleResp = await iam.send(new GetRoleCommand({ RoleName: roleName }));
      const role = roleResp.Role;
      if (!role) {
        res.status(404).json({ error: "Role not found" });
        return;
      }

      const attachedResp = await iam.send(
        new ListAttachedRolePoliciesCommand({ RoleName: roleName })
      );
      const inlineResp = await iam.send(
        new ListRolePoliciesCommand({ RoleName: roleName })
      );

      res.json({
        resourceType: "IAM_ROLE",
        resourceId,
        name: role.RoleName,
        state: "active",
        createdAt: role.CreateDate?.toISOString(),
        tags: role.Tags?.map((t) => ({ key: t.Key || "", value: t.Value || "" })) || [],
        attributes: {
          arn: role.Arn || "",
          path: role.Path || "",
          description: role.Description || "",
          maxSessionDuration: String(role.MaxSessionDuration || 3600),
        },
        iamInfo: {
          attachedPolicies:
            attachedResp.AttachedPolicies?.map(
              (p) => `${p.PolicyName} (${p.PolicyArn})`
            ) || [],
          inlinePolicies: inlineResp.PolicyNames || [],
          lastUsed: role.RoleLastUsed?.LastUsedDate?.toISOString() || "never",
        },
      });
    } else if (resourceType === "S3_BUCKET") {
      res.json({
        resourceType: "S3_BUCKET",
        resourceId,
        name: resourceId,
        state: "active",
        attributes: {
          bucketName: resourceId,
        },
        tags: [],
      });
    } else {
      res.status(400).json({ error: "Unsupported resource type" });
    }
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch resource details");
    res.status(500).json({ error: err?.message || "Failed to fetch resource details" });
  }
});

// POST /api/aws/investigate
router.post("/aws/investigate", async (req, res) => {
  const parsed = InvestigateFindingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { credentials, resourceId, resourceType, findingId, alertId } = parsed.data;
  const cfg = makeAwsConfig(credentials);

  try {
    // Fetch CloudTrail events for the resource
    const ct = new CloudTrailClient(cfg);
    const startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
    const endTime = new Date();

    let cloudTrailEvents: any[] = [];
    const lookupValues: string[] = [];

    // Extract usable lookup values from resourceId
    if (resourceType === "EC2_INSTANCE") {
      lookupValues.push(resourceId);
    } else if (resourceType === "IAM_ROLE") {
      const roleName = resourceId.includes("/") ? resourceId.split("/").pop()! : resourceId;
      lookupValues.push(roleName);
    } else {
      lookupValues.push(resourceId);
    }

    for (const val of lookupValues) {
      try {
        const resp = await ct.send(
          new LookupEventsCommand({
            LookupAttributes: [
              { AttributeKey: LookupAttributeKey.RESOURCE_NAME, AttributeValue: val },
            ],
            StartTime: startTime,
            EndTime: endTime,
            MaxResults: 30,
          })
        );
        cloudTrailEvents.push(...(resp.Events || []));
      } catch {}
    }

    // Also look up by username if IAM
    if (resourceType === "IAM_ROLE") {
      try {
        const roleName = resourceId.includes("/") ? resourceId.split("/").pop()! : resourceId;
        const resp = await ct.send(
          new LookupEventsCommand({
            LookupAttributes: [
              { AttributeKey: LookupAttributeKey.USERNAME, AttributeValue: roleName },
            ],
            StartTime: startTime,
            EndTime: endTime,
            MaxResults: 20,
          })
        );
        cloudTrailEvents.push(...(resp.Events || []));
      } catch {}
    }

    // Deduplicate events
    const seen = new Set<string>();
    cloudTrailEvents = cloudTrailEvents.filter((e) => {
      const key = `${e.EventId || e.EventTime?.toISOString()}-${e.EventName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by time
    cloudTrailEvents.sort(
      (a, b) =>
        (a.EventTime?.getTime() || 0) - (b.EventTime?.getTime() || 0)
    );

    // Fetch resource snapshot
    let resourceSnapshot: any = null;
    try {
      const resourceReq = await fetch(
        `http://localhost:${process.env.PORT || 8080}/api/aws/resource-details`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentials, resourceType, resourceId }),
        }
      );
      if (resourceReq.ok) {
        resourceSnapshot = await resourceReq.json();
      }
    } catch {}

    // Build timeline
    const timeline = cloudTrailEvents.slice(0, 40).map((e) => {
      const cloudTrailEvent = e.CloudTrailEvent ? JSON.parse(e.CloudTrailEvent) : {};
      const errorCode = cloudTrailEvent.errorCode;
      const errorMessage = cloudTrailEvent.errorMessage;
      return {
        timestamp: e.EventTime?.toISOString() || new Date().toISOString(),
        eventName: e.EventName || "Unknown",
        eventSource: cloudTrailEvent.eventSource || e.EventSource || "",
        sourceIPAddress: cloudTrailEvent.sourceIPAddress || "",
        userAgent: cloudTrailEvent.userAgent || "",
        userIdentity:
          cloudTrailEvent.userIdentity?.arn ||
          cloudTrailEvent.userIdentity?.userName ||
          e.Username ||
          "",
        outcome: errorCode ? `ERROR: ${errorCode}` : "SUCCESS",
        details: errorMessage || cloudTrailEvent.requestParameters
          ? JSON.stringify(cloudTrailEvent.requestParameters || {}).slice(0, 200)
          : "",
      };
    });

    // Build alert context for AI
    let alertContext = "";
    if (alertId) {
      try {
        const [alert] = await db
          .select()
          .from(alertsTable)
          .where(eq(alertsTable.id, alertId));
        if (alert) {
          alertContext = `\nGuardDuty Finding: ${alert.title}\nType: ${alert.type}\nDescription: ${alert.description}\nMITRE: ${alert.mitreAttackTactic} / ${alert.mitreAttackTechnique}`;
        }
      } catch {}
    }

    // Use AI to generate investigation report
    const aiPrompt = `You are an AWS security incident responder. Analyze the following data and generate an incident investigation report.

Resource: ${resourceType} — ${resourceId}
Region: ${credentials.region}
${alertContext}

CloudTrail Events (last 7 days, ${timeline.length} events):
${timeline.map((e) => `[${e.timestamp}] ${e.eventName} from ${e.sourceIPAddress} — ${e.outcome}`).join("\n")}

Resource Snapshot:
${JSON.stringify(resourceSnapshot || {}, null, 2).slice(0, 2000)}

Respond ONLY with a valid JSON object with these exact fields:
{
  "summary": "2-3 sentence executive summary of what happened and the risk",
  "riskScore": <integer 0-100>,
  "indicators": ["list of specific indicators of compromise found in the data"],
  "relatedResources": ["list of related AWS resources mentioned in the events"],
  "recommendations": ["numbered list of specific recommended actions"]
}`;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: [{ role: "user", content: aiPrompt }],
      response_format: { type: "json_object" },
    });

    const aiResult = JSON.parse(
      aiResponse.choices[0]?.message?.content || "{}"
    );

    res.json({
      summary: aiResult.summary || "Investigation complete.",
      riskScore: aiResult.riskScore || 50,
      timeline,
      relatedResources: aiResult.relatedResources || [],
      indicators: aiResult.indicators || [],
      recommendations: aiResult.recommendations || [],
      resourceSnapshot,
    });
  } catch (err: any) {
    req.log.error({ err }, "Investigation failed");
    res.status(500).json({ error: err?.message || "Investigation failed" });
  }
});

// POST /api/aws/import-finding
router.post("/aws/import-finding", async (req, res) => {
  const parsed = ImportAndAnalyzeFindingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { credentials: _creds, findingRawJson } = parsed.data;

  try {
    const analysis = await analyzeGuardDutyAlert(findingRawJson);

    const [alert] = await db
      .insert(alertsTable)
      .values({
        title: analysis.title,
        severity: analysis.severity,
        type: analysis.type,
        affectedResource: analysis.affectedResource,
        resourceType: analysis.resourceType,
        region: analysis.region,
        accountId: analysis.accountId,
        description: analysis.description,
        mitreAttackTactic: analysis.mitreAttackTactic,
        mitreAttackTechnique: analysis.mitreAttackTechnique,
        mitreAttackTechniqueId: analysis.mitreAttackTechniqueId,
        mitreAttackMitigation: analysis.mitreAttackMitigation,
        remediationScript: analysis.remediationScript,
        remediationStatus: "generated",
        rawAlert: findingRawJson,
      })
      .returning();

    res.status(201).json({
      ...alert,
      createdAt: alert!.createdAt.toISOString(),
      updatedAt: alert!.updatedAt.toISOString(),
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to import finding");
    res.status(500).json({ error: err?.message || "Failed to import finding" });
  }
});

export default router;

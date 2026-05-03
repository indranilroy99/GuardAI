/**
 * AWS Cloud Shell Terminal Route
 *
 * POST /api/terminal/exec
 *   Parses AWS CLI-style commands and executes them via AWS SDK.
 *   Credentials are passed per-request from browser sessionStorage — never stored server-side.
 *
 * Supported services: sts, guardduty, ec2, iam, cloudtrail, s3, lambda, logs, eks, rds
 */

import { Router } from "express";
import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  GuardDutyClient,
  ListDetectorsCommand,
  GetDetectorCommand,
  ListFindingsCommand,
  GetFindingsCommand,
  ListIPSetsCommand,
  ListThreatIntelSetsCommand,
} from "@aws-sdk/client-guardduty";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeNetworkInterfacesCommand,
  DescribeRegionsCommand,
  DescribeSnapshotsCommand,
  DescribeVolumesCommand,
} from "@aws-sdk/client-ec2";
import {
  IAMClient,
  ListUsersCommand,
  ListRolesCommand,
  GetRoleCommand,
  ListAttachedRolePoliciesCommand,
  ListPoliciesCommand,
  GetPolicyCommand,
  ListGroupsCommand,
  ListAccessKeysCommand,
  GetAccountSummaryCommand,
  GetAccountPasswordPolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CloudTrailClient,
  LookupEventsCommand,
  DescribeTrailsCommand,
  GetTrailStatusCommand,
} from "@aws-sdk/client-cloudtrail";
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  ListEventSourceMappingsCommand,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  DescribeDBSnapshotsCommand,
} from "@aws-sdk/client-rds";
import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
} from "@aws-sdk/client-eks";

const router = Router();

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
}

interface ParsedCommand {
  service: string;
  command: string;
  flags: Record<string, string | string[]>;
  args: string[];
}

// ─── Command Parser ───────────────────────────────────────────────────────────

function parseCommand(input: string): ParsedCommand | null {
  const parts = input.trim().split(/\s+/);
  if (parts[0] !== "aws" || parts.length < 3) return null;

  const service = parts[1]?.toLowerCase() ?? "";
  const command = parts[2]?.toLowerCase() ?? "";
  const flags: Record<string, string | string[]> = {};
  const args: string[] = [];

  let i = 3;
  while (i < parts.length) {
    const p = parts[i]!;
    if (p.startsWith("--")) {
      const key = p.slice(2);
      const next = parts[i + 1];
      if (next && !next.startsWith("--")) {
        // Handle space-separated values for --flag val1 val2
        const values: string[] = [next];
        let j = i + 2;
        while (j < parts.length && !parts[j]!.startsWith("--")) {
          values.push(parts[j]!);
          j++;
        }
        flags[key] = values.length === 1 ? values[0]! : values;
        i = j;
      } else {
        flags[key] = "true";
        i++;
      }
    } else {
      args.push(p);
      i++;
    }
  }

  return { service, command, flags, args };
}

function flag(flags: Record<string, string | string[]>, name: string): string | undefined {
  const v = flags[name];
  return Array.isArray(v) ? v[0] : v;
}

function flagArr(flags: Record<string, string | string[]>, name: string): string[] {
  const v = flags[name];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ─── Executor ─────────────────────────────────────────────────────────────────

async function executeCommand(parsed: ParsedCommand, creds: AwsCredentials): Promise<unknown> {
  const region = flag(parsed.flags, "region") ?? creds.region ?? "us-east-1";
  const credentials = {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
  };

  const cfg = { region, credentials };

  switch (parsed.service) {
    // ─── STS ─────────────────────────────────────────────────────────────
    case "sts": {
      const client = new STSClient(cfg);
      if (parsed.command === "get-caller-identity") {
        return client.send(new GetCallerIdentityCommand({}));
      }
      if (parsed.command === "assume-role") {
        return client.send(new AssumeRoleCommand({
          RoleArn: flag(parsed.flags, "role-arn"),
          RoleSessionName: flag(parsed.flags, "role-session-name") ?? "GuardAI",
          DurationSeconds: parseInt(flag(parsed.flags, "duration-seconds") ?? "3600"),
        }));
      }
      break;
    }

    // ─── GuardDuty ───────────────────────────────────────────────────────
    case "guardduty": {
      const client = new GuardDutyClient(cfg);
      if (parsed.command === "list-detectors") {
        return client.send(new ListDetectorsCommand({}));
      }
      if (parsed.command === "get-detector") {
        return client.send(new GetDetectorCommand({ DetectorId: flag(parsed.flags, "detector-id")! }));
      }
      if (parsed.command === "list-findings") {
        return client.send(new ListFindingsCommand({
          DetectorId: flag(parsed.flags, "detector-id")!,
          FindingCriteria: flag(parsed.flags, "finding-criteria")
            ? JSON.parse(flag(parsed.flags, "finding-criteria")!) as Record<string, unknown>
            : undefined,
          MaxResults: parseInt(flag(parsed.flags, "max-results") ?? "20"),
        }));
      }
      if (parsed.command === "get-findings") {
        return client.send(new GetFindingsCommand({
          DetectorId: flag(parsed.flags, "detector-id")!,
          FindingIds: flagArr(parsed.flags, "finding-ids"),
        }));
      }
      if (parsed.command === "list-ip-sets") {
        return client.send(new ListIPSetsCommand({ DetectorId: flag(parsed.flags, "detector-id")! }));
      }
      if (parsed.command === "list-threat-intel-sets") {
        return client.send(new ListThreatIntelSetsCommand({ DetectorId: flag(parsed.flags, "detector-id")! }));
      }
      break;
    }

    // ─── EC2 ─────────────────────────────────────────────────────────────
    case "ec2": {
      const client = new EC2Client(cfg);
      if (parsed.command === "describe-instances") {
        return client.send(new DescribeInstancesCommand({
          InstanceIds: flagArr(parsed.flags, "instance-ids"),
          MaxResults: parseInt(flag(parsed.flags, "max-results") ?? "50"),
        }));
      }
      if (parsed.command === "describe-security-groups") {
        return client.send(new DescribeSecurityGroupsCommand({
          GroupIds: flagArr(parsed.flags, "group-ids"),
        }));
      }
      if (parsed.command === "describe-vpcs") {
        return client.send(new DescribeVpcsCommand({
          VpcIds: flagArr(parsed.flags, "vpc-ids"),
        }));
      }
      if (parsed.command === "describe-subnets") {
        return client.send(new DescribeSubnetsCommand({}));
      }
      if (parsed.command === "describe-network-interfaces") {
        return client.send(new DescribeNetworkInterfacesCommand({
          MaxResults: 50,
        }));
      }
      if (parsed.command === "describe-regions") {
        return client.send(new DescribeRegionsCommand({}));
      }
      if (parsed.command === "describe-snapshots") {
        return client.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"], MaxResults: 50 }));
      }
      if (parsed.command === "describe-volumes") {
        return client.send(new DescribeVolumesCommand({ MaxResults: 50 }));
      }
      break;
    }

    // ─── IAM ─────────────────────────────────────────────────────────────
    case "iam": {
      const client = new IAMClient(cfg);
      if (parsed.command === "list-users") {
        return client.send(new ListUsersCommand({ MaxItems: parseInt(flag(parsed.flags, "max-items") ?? "50") }));
      }
      if (parsed.command === "list-roles") {
        return client.send(new ListRolesCommand({ MaxItems: parseInt(flag(parsed.flags, "max-items") ?? "50") }));
      }
      if (parsed.command === "get-role") {
        return client.send(new GetRoleCommand({ RoleName: flag(parsed.flags, "role-name")! }));
      }
      if (parsed.command === "list-attached-role-policies") {
        return client.send(new ListAttachedRolePoliciesCommand({ RoleName: flag(parsed.flags, "role-name")! }));
      }
      if (parsed.command === "list-policies") {
        return client.send(new ListPoliciesCommand({
          Scope: (flag(parsed.flags, "scope") as "All" | "AWS" | "Local") ?? "Local",
          MaxItems: parseInt(flag(parsed.flags, "max-items") ?? "50"),
        }));
      }
      if (parsed.command === "get-policy") {
        return client.send(new GetPolicyCommand({ PolicyArn: flag(parsed.flags, "policy-arn")! }));
      }
      if (parsed.command === "list-groups") {
        return client.send(new ListGroupsCommand({ MaxItems: 50 }));
      }
      if (parsed.command === "list-access-keys") {
        return client.send(new ListAccessKeysCommand({ UserName: flag(parsed.flags, "user-name") }));
      }
      if (parsed.command === "get-account-summary") {
        return client.send(new GetAccountSummaryCommand({}));
      }
      if (parsed.command === "get-account-password-policy") {
        return client.send(new GetAccountPasswordPolicyCommand({}));
      }
      break;
    }

    // ─── CloudTrail ──────────────────────────────────────────────────────
    case "cloudtrail": {
      const client = new CloudTrailClient(cfg);
      if (parsed.command === "lookup-events") {
        return client.send(new LookupEventsCommand({
          MaxResults: parseInt(flag(parsed.flags, "max-results") ?? "20"),
          StartTime: flag(parsed.flags, "start-time") ? new Date(flag(parsed.flags, "start-time")!) : undefined,
          EndTime: flag(parsed.flags, "end-time") ? new Date(flag(parsed.flags, "end-time")!) : undefined,
        }));
      }
      if (parsed.command === "describe-trails") {
        return client.send(new DescribeTrailsCommand({ includeShadowTrails: true }));
      }
      if (parsed.command === "get-trail-status") {
        return client.send(new GetTrailStatusCommand({ Name: flag(parsed.flags, "name")! }));
      }
      break;
    }

    // ─── S3 ──────────────────────────────────────────────────────────────
    case "s3":
    case "s3api": {
      const client = new S3Client(cfg);
      if (parsed.command === "ls" || parsed.command === "list-buckets") {
        return client.send(new ListBucketsCommand({}));
      }
      if (parsed.command === "ls" && parsed.args[0]?.startsWith("s3://")) {
        const bucket = parsed.args[0].replace("s3://", "").split("/")[0]!;
        const prefix = parsed.args[0].replace("s3://", "").split("/").slice(1).join("/");
        return client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 50 }));
      }
      if (parsed.command === "get-bucket-location") {
        return client.send(new GetBucketLocationCommand({ Bucket: flag(parsed.flags, "bucket")! }));
      }
      if (parsed.command === "get-bucket-versioning") {
        return client.send(new GetBucketVersioningCommand({ Bucket: flag(parsed.flags, "bucket")! }));
      }
      if (parsed.command === "get-bucket-encryption") {
        return client.send(new GetBucketEncryptionCommand({ Bucket: flag(parsed.flags, "bucket")! }));
      }
      if (parsed.command === "get-public-access-block") {
        return client.send(new GetPublicAccessBlockCommand({ Bucket: flag(parsed.flags, "bucket")! }));
      }
      break;
    }

    // ─── Lambda ──────────────────────────────────────────────────────────
    case "lambda": {
      const client = new LambdaClient(cfg);
      if (parsed.command === "list-functions") {
        return client.send(new ListFunctionsCommand({ MaxItems: parseInt(flag(parsed.flags, "max-items") ?? "50") }));
      }
      if (parsed.command === "get-function") {
        return client.send(new GetFunctionCommand({ FunctionName: flag(parsed.flags, "function-name")! }));
      }
      if (parsed.command === "list-event-source-mappings") {
        return client.send(new ListEventSourceMappingsCommand({}));
      }
      break;
    }

    // ─── CloudWatch Logs ─────────────────────────────────────────────────
    case "logs": {
      const client = new CloudWatchLogsClient(cfg);
      if (parsed.command === "describe-log-groups") {
        return client.send(new DescribeLogGroupsCommand({
          logGroupNamePrefix: flag(parsed.flags, "log-group-name-prefix"),
          limit: parseInt(flag(parsed.flags, "limit") ?? "50"),
        }));
      }
      if (parsed.command === "describe-log-streams") {
        return client.send(new DescribeLogStreamsCommand({
          logGroupName: flag(parsed.flags, "log-group-name")!,
          limit: parseInt(flag(parsed.flags, "limit") ?? "20"),
        }));
      }
      if (parsed.command === "filter-log-events") {
        return client.send(new FilterLogEventsCommand({
          logGroupName: flag(parsed.flags, "log-group-name")!,
          filterPattern: flag(parsed.flags, "filter-pattern"),
          limit: parseInt(flag(parsed.flags, "limit") ?? "50"),
        }));
      }
      break;
    }

    // ─── RDS ─────────────────────────────────────────────────────────────
    case "rds": {
      const client = new RDSClient(cfg);
      if (parsed.command === "describe-db-instances") {
        return client.send(new DescribeDBInstancesCommand({
          DBInstanceIdentifier: flag(parsed.flags, "db-instance-identifier"),
          MaxRecords: parseInt(flag(parsed.flags, "max-records") ?? "50"),
        }));
      }
      if (parsed.command === "describe-db-clusters") {
        return client.send(new DescribeDBClustersCommand({}));
      }
      if (parsed.command === "describe-db-snapshots") {
        return client.send(new DescribeDBSnapshotsCommand({ MaxRecords: 50 }));
      }
      break;
    }

    // ─── EKS ─────────────────────────────────────────────────────────────
    case "eks": {
      const client = new EKSClient(cfg);
      if (parsed.command === "list-clusters") {
        return client.send(new ListClustersCommand({}));
      }
      if (parsed.command === "describe-cluster") {
        return client.send(new DescribeClusterCommand({ name: flag(parsed.flags, "name")! }));
      }
      if (parsed.command === "list-nodegroups") {
        return client.send(new ListNodegroupsCommand({ clusterName: flag(parsed.flags, "cluster-name")! }));
      }
      break;
    }
  }

  throw new Error(`Unsupported command: aws ${parsed.service} ${parsed.command}`);
}

// ─── Strip AWS SDK metadata from response ─────────────────────────────────────

function cleanResponse(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanResponse);
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "$metadata" || k === "$fault" || k === "$service") continue;
    cleaned[k] = cleanResponse(v);
  }
  return cleaned;
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post("/terminal/exec", async (req, res) => {
  const { command, credentials } = req.body as {
    command: string;
    credentials: AwsCredentials;
  };

  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command is required" });
    return;
  }

  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
    res.status(400).json({ error: "AWS credentials are required" });
    return;
  }

  // Built-in commands
  const trimmed = command.trim();
  if (trimmed === "help") {
    res.json({
      output: HELP_TEXT,
      kind: "help",
    });
    return;
  }
  if (trimmed === "clear") {
    res.json({ output: "", kind: "clear" });
    return;
  }
  if (trimmed === "whoami") {
    try {
      const client = new STSClient({
        region: credentials.region ?? "us-east-1",
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
        },
      });
      const result = await client.send(new GetCallerIdentityCommand({}));
      res.json({ output: cleanResponse(result), kind: "json" });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
    return;
  }

  const parsed = parseCommand(trimmed);
  if (!parsed) {
    res.status(400).json({ error: `Unrecognized command. Type "help" to see available commands.` });
    return;
  }

  try {
    const result = await executeCommand(parsed, credentials);
    res.json({ output: cleanResponse(result), kind: "json" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

const HELP_TEXT = `GUARD AI — AWS Cloud Shell
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUILT-IN
  help                              Show this help
  whoami                            Get caller identity
  clear                             Clear terminal

STS
  aws sts get-caller-identity
  aws sts assume-role --role-arn <ARN> --role-session-name <NAME>

GUARDDUTY
  aws guardduty list-detectors
  aws guardduty get-detector --detector-id <ID>
  aws guardduty list-findings --detector-id <ID> [--max-results 20]
  aws guardduty get-findings --detector-id <ID> --finding-ids <ID...>
  aws guardduty list-ip-sets --detector-id <ID>
  aws guardduty list-threat-intel-sets --detector-id <ID>

EC2
  aws ec2 describe-instances [--instance-ids <IDs>] [--region <r>]
  aws ec2 describe-security-groups [--group-ids <IDs>]
  aws ec2 describe-vpcs [--vpc-ids <IDs>]
  aws ec2 describe-subnets
  aws ec2 describe-network-interfaces
  aws ec2 describe-regions
  aws ec2 describe-volumes
  aws ec2 describe-snapshots

IAM
  aws iam list-users [--max-items 50]
  aws iam list-roles [--max-items 50]
  aws iam get-role --role-name <NAME>
  aws iam list-attached-role-policies --role-name <NAME>
  aws iam list-policies [--scope Local|AWS|All]
  aws iam list-groups
  aws iam list-access-keys [--user-name <NAME>]
  aws iam get-account-summary
  aws iam get-account-password-policy

CLOUDTRAIL
  aws cloudtrail describe-trails
  aws cloudtrail lookup-events [--max-results 20] [--start-time <T>] [--end-time <T>]
  aws cloudtrail get-trail-status --name <NAME>

S3 / S3API
  aws s3 ls
  aws s3 ls s3://<bucket>/<prefix>
  aws s3api get-bucket-location --bucket <NAME>
  aws s3api get-bucket-versioning --bucket <NAME>
  aws s3api get-bucket-encryption --bucket <NAME>
  aws s3api get-public-access-block --bucket <NAME>

LAMBDA
  aws lambda list-functions [--max-items 50]
  aws lambda get-function --function-name <NAME>
  aws lambda list-event-source-mappings

CLOUDWATCH LOGS
  aws logs describe-log-groups [--log-group-name-prefix <P>]
  aws logs describe-log-streams --log-group-name <NAME>
  aws logs filter-log-events --log-group-name <NAME> [--filter-pattern <P>]

RDS
  aws rds describe-db-instances [--db-instance-identifier <ID>]
  aws rds describe-db-clusters
  aws rds describe-db-snapshots

EKS
  aws eks list-clusters
  aws eks describe-cluster --name <NAME>
  aws eks list-nodegroups --cluster-name <NAME>

FLAGS
  --region <region>   Override region for any command
`;

export default router;

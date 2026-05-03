/**
 * Onboarding Wizard
 *
 * Step-by-step plug-and-play setup guide for new users.
 * Covers: AWS GuardDuty → EventBridge → Webhook → AI model → First alert test.
 */
import { useState } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Circle, ChevronRight, Copy, Check, ExternalLink,
  Shield, Zap, Brain, Globe, Terminal, Building2, ArrowRight,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };
  return { copy, copiedKey };
}

function CodeBlock({ code, copyKey, onCopy, copiedKey }: { code: string; copyKey: string; onCopy: (t: string, k: string) => void; copiedKey: string | null }) {
  return (
    <div className="relative group bg-[#08111a] border border-[#1f2f40] rounded-[3px] overflow-hidden">
      <pre className="p-4 font-mono text-[11px] text-[#9ca3af] overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{code}</pre>
      <button
        onClick={() => onCopy(code, copyKey)}
        className="absolute top-2 right-2 p-1.5 bg-[#141f2e] border border-[#1f2f40] rounded-[2px] text-[#415161] hover:text-[#ff9900] transition-all opacity-0 group-hover:opacity-100"
      >
        {copiedKey === copyKey ? <Check className="w-3 h-3 text-[#1db954]" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

const STEPS = [
  { id: "guardduty", label: "Enable GuardDuty", icon: Shield },
  { id: "eventbridge", label: "Connect EventBridge", icon: Globe },
  { id: "ai", label: "Choose AI Model", icon: Brain },
  { id: "accounts", label: "Register Account", icon: Building2 },
  { id: "test", label: "Send Test Alert", icon: Zap },
];

export function Onboarding() {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const { copy, copiedKey } = useCopy();

  const mark = (i: number) => setCompleted((s) => { const n = new Set(s); n.add(i); return n; });

  // Derive webhook info (won't have token without API call, show instructions)
  const webhookUrl = `${window.location.origin}/api/integrations/guardduty/webhook`;

  return (
    <div className="max-w-4xl mx-auto pb-16 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-mono font-bold text-[22px] tracking-tight text-[#e8eaf0]">SETUP GUIDE</h1>
        <p className="font-mono text-[11px] text-[#415161] tracking-[0.08em]">
          Connect GuardAI to your AWS environment in under 10 minutes
        </p>
      </div>

      {/* Progress stepper */}
      <div className="flex items-center gap-0">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const done = completed.has(i);
          const active = current === i;
          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <button
                onClick={() => setCurrent(i)}
                className={`flex items-center gap-2 px-3 py-2 rounded-[3px] transition-all w-full ${active ? "bg-[#ff990010] border border-[#ff990030]" : "hover:bg-[#141f2e]"}`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  done ? "bg-[#1db954]" : active ? "bg-[#ff9900]" : "bg-[#1f2f40]"
                }`}>
                  {done
                    ? <Check className="w-3 h-3 text-[#0f1923]" />
                    : <Icon className={`w-3 h-3 ${active ? "text-[#0f1923]" : "text-[#415161]"}`} />
                  }
                </div>
                <div className="text-left">
                  <div className={`font-mono text-[9px] tracking-wider ${active ? "text-[#ff9900]" : done ? "text-[#1db954]" : "text-[#415161]"}`}>
                    STEP {i + 1}
                  </div>
                  <div className={`font-mono text-[11px] font-medium ${active ? "text-[#e8eaf0]" : done ? "text-[#7f9ab0]" : "text-[#415161]"}`}>
                    {step.label}
                  </div>
                </div>
              </button>
              {i < STEPS.length - 1 && (
                <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 mx-1 ${done ? "text-[#1db954]" : "text-[#1f2f40]"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="bg-[#141f2e] border border-[#1f2f40] rounded-[3px] overflow-hidden">

        {/* ── Step 0: Enable GuardDuty ── */}
        {current === 0 && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-[#ff9900] flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="font-mono font-bold text-[16px] text-[#e8eaf0]">Enable AWS GuardDuty</h2>
                <p className="font-mono text-[11px] text-[#415161] mt-1">GuardDuty is AWS's native threat detection service. It monitors CloudTrail, VPC Flow Logs, and DNS logs for suspicious activity.</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OPTION A — AWS Console (easiest)</div>
                <ol className="space-y-2 pl-4">
                  {[
                    "Go to AWS Console → GuardDuty",
                    "Click \"Get Started\" then \"Enable GuardDuty\"",
                    "GuardDuty is free for the first 30 days, then ~$4–$10/month depending on data volume",
                    "For multi-region coverage, enable GuardDuty in every region you operate in",
                  ].map((s, i) => (
                    <li key={i} className="flex items-start gap-2 font-mono text-[11px] text-[#9ca3af]">
                      <span className="text-[#415161] flex-shrink-0">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OPTION B — AWS CLI</div>
                <CodeBlock
                  copyKey="gd-enable"
                  copiedKey={copiedKey}
                  onCopy={copy}
                  code={`# Enable in us-east-1
aws guardduty create-detector --enable --region us-east-1

# Enable in all active regions
for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  aws guardduty create-detector --enable --region $region
done`}
                />
              </div>
              <div className="p-3 bg-[#ff990008] border border-[#ff990020] rounded-[3px] font-mono text-[10px] text-[#415161]">
                <span className="text-[#ff9900]">Tip:</span> GuardDuty has a 30-day free trial. After that, cost scales with your CloudTrail event volume — typically $3–15/month for small environments.
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <a href="https://console.aws.amazon.com/guardduty" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono text-[11px] text-[#ff9900] hover:underline">
                Open GuardDuty in AWS Console <ExternalLink className="w-3 h-3" />
              </a>
              <button onClick={() => { mark(0); setCurrent(1); }} className="flex items-center gap-2 px-4 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px] transition-all">
                GuardDuty Enabled <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: EventBridge ── */}
        {current === 1 && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3">
              <Globe className="w-5 h-5 text-[#ff9900] flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="font-mono font-bold text-[16px] text-[#e8eaf0]">Connect AWS EventBridge → Sentinel</h2>
                <p className="font-mono text-[11px] text-[#415161] mt-1">
                  EventBridge routes GuardDuty findings to your Sentinel webhook in real time (typically within 2–5 seconds of detection).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">YOUR WEBHOOK URL</div>
                <div className="flex items-center gap-2 bg-[#0f1923] border border-[#1f2f40] rounded-[2px] px-3 py-2">
                  <span className="font-mono text-[11px] text-[#ff9900] truncate flex-1">{webhookUrl}</span>
                  <button onClick={() => copy(webhookUrl, "webhook-url")} className="text-[#415161] hover:text-[#ff9900] flex-shrink-0">
                    {copiedKey === "webhook-url" ? <Check className="w-3 h-3 text-[#1db954]" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">TOKEN HEADER</div>
                <Link href="/integrations">
                  <div className="flex items-center gap-2 bg-[#0f1923] border border-[#ff990030] rounded-[2px] px-3 py-2 cursor-pointer hover:bg-[#1a2535] transition-colors">
                    <span className="font-mono text-[11px] text-[#415161] flex-1">Get token from Integrations page</span>
                    <ChevronRight className="w-3 h-3 text-[#ff9900]" />
                  </div>
                </Link>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OPTION A — AWS CloudFormation (recommended, 1-click)</div>
              <CodeBlock
                copyKey="cfn"
                copiedKey={copiedKey}
                onCopy={copy}
                code={`AWSTemplateFormatVersion: '2010-09-09'
Description: GuardAI — GuardDuty EventBridge integration

Parameters:
  SentinelWebhookUrl:
    Type: String
    Description: Your GuardAI webhook URL
  SentinelToken:
    Type: String
    Description: Your X-Sentinel-Token value
    NoEcho: true

Resources:
  SentinelEventBusConnection:
    Type: AWS::Events::Connection
    Properties:
      AuthorizationType: API_KEY
      AuthParameters:
        ApiKeyAuthParameters:
          ApiKeyName: X-Sentinel-Token
          ApiKeyValue: !Ref SentinelToken

  SentinelApiDestination:
    Type: AWS::Events::ApiDestination
    Properties:
      ConnectionArn: !GetAtt SentinelEventBusConnection.Arn
      HttpMethod: POST
      InvocationEndpoint: !Ref SentinelWebhookUrl
      InvocationRateLimitPerSecond: 300

  SentinelGuardDutyRule:
    Type: AWS::Events::Rule
    Properties:
      Name: guardai-guardduty-findings
      Description: Route GuardDuty findings to GuardAI
      EventPattern:
        source: [aws.guardduty]
        detail-type: [GuardDuty Finding]
      State: ENABLED
      Targets:
        - Id: GuardAI
          Arn: !GetAtt SentinelApiDestination.Arn
          RoleArn: !GetAtt EventBridgeRole.Arn

  EventBridgeRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: events.amazonaws.com
            Action: sts:AssumeRole
      Policies:
        - PolicyName: InvokeSentinelApiDestination
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: events:InvokeApiDestination
                Resource: !GetAtt SentinelApiDestination.Arn`}
              />
            </div>

            <div className="space-y-2">
              <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OPTION B — AWS CLI (quick setup)</div>
              <CodeBlock
                copyKey="eb-cli"
                copiedKey={copiedKey}
                onCopy={copy}
                code={`WEBHOOK_URL="${webhookUrl}"
TOKEN="<your-sentinel-token-from-integrations-page>"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# 1. Create the connection (stores token securely in Secrets Manager)
CONNECTION_ARN=$(aws events create-connection \\
  --name guardai-conn \\
  --authorization-type API_KEY \\
  --auth-parameters "ApiKeyAuthParameters={ApiKeyName=X-Sentinel-Token,ApiKeyValue=$TOKEN}" \\
  --query ConnectionArn --output text)

# 2. Create the API destination
DEST_ARN=$(aws events create-api-destination \\
  --name guardai-dest \\
  --connection-arn $CONNECTION_ARN \\
  --http-method POST \\
  --invocation-endpoint $WEBHOOK_URL \\
  --invocation-rate-limit-per-second 300 \\
  --query ApiDestinationArn --output text)

# 3. Create IAM role for EventBridge to invoke the destination
ROLE_ARN=$(aws iam create-role \\
  --role-name GuardAIEventBridgeRole \\
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"events.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \\
  --query Role.Arn --output text)

aws iam put-role-policy \\
  --role-name GuardAIEventBridgeRole \\
  --policy-name InvokeDestination \\
  --policy-document "{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Action\\\":\\\"events:InvokeApiDestination\\\",\\\"Resource\\\":\\\"$DEST_ARN\\\"}]}"

# 4. Create the EventBridge rule
aws events put-rule \\
  --name guardai-guardduty-findings \\
  --event-pattern '{"source":["aws.guardduty"],"detail-type":["GuardDuty Finding"]}' \\
  --state ENABLED

aws events put-targets \\
  --rule guardai-guardduty-findings \\
  --targets "Id=GuardAI,Arn=$DEST_ARN,RoleArn=$ROLE_ARN"`}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link href="/integrations">
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#ff9900] hover:underline cursor-pointer">
                  Get your webhook token → Integrations page
                </span>
              </Link>
              <button onClick={() => { mark(1); setCurrent(2); }} className="flex items-center gap-2 px-4 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px]">
                EventBridge Configured <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: AI Model ── */}
        {current === 2 && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3">
              <Brain className="w-5 h-5 text-[#ff9900] flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="font-mono font-bold text-[16px] text-[#e8eaf0]">Choose Your AI Model</h2>
                <p className="font-mono text-[11px] text-[#415161] mt-1">
                  Sentinel uses an AI model for the iterative triage investigation. Choose OpenRouter (free, open-source) or OpenAI (GPT-4o, highest accuracy).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  title: "OpenRouter — Open Source (Default)",
                  tag: "FREE",
                  tagColor: "#1db954",
                  model: "meta-llama/llama-3.3-70b-instruct:free",
                  desc: "Llama 3.3 70B — Meta's flagship open-source model. No API key required on Replit. 70 billion parameters, strong reasoning for security analysis.",
                  env: "AI_PROVIDER=openrouter\nAI_MODEL=meta-llama/llama-3.3-70b-instruct:free",
                  pros: ["Free tier — no costs", "No OpenAI account needed", "Open weights, self-hostable"],
                  cons: ["Slightly slower than GPT-4o", "Rate limits on free tier"],
                },
                {
                  title: "OpenAI GPT-4o",
                  tag: "PAID",
                  tagColor: "#f59e0b",
                  model: "gpt-4o",
                  desc: "OpenAI's best model for complex reasoning. Consistently higher accuracy on MITRE ATT&CK attribution and false-positive detection.",
                  env: "AI_PROVIDER=openai\nAI_MODEL=gpt-4o\nOPENAI_API_KEY=sk-...",
                  pros: ["Highest accuracy", "Fastest response", "Best JSON compliance"],
                  cons: ["~$0.01–0.05 per alert", "Requires OpenAI account"],
                },
              ].map((opt) => (
                <div key={opt.title} className="bg-[#0f1923] border border-[#1f2f40] rounded-[3px] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono text-[12px] font-bold text-[#e8eaf0]">{opt.title}</div>
                    <span className="px-1.5 py-[2px] rounded-[2px] font-mono text-[8px] font-bold flex-shrink-0" style={{ backgroundColor: opt.tagColor + "20", color: opt.tagColor, border: `1px solid ${opt.tagColor}40` }}>{opt.tag}</span>
                  </div>
                  <p className="font-mono text-[10px] text-[#7f9ab0] leading-relaxed">{opt.desc}</p>
                  <div className="space-y-1">
                    {opt.pros.map((p) => <div key={p} className="flex items-center gap-1.5 font-mono text-[10px] text-[#1db954]"><Check className="w-2.5 h-2.5 flex-shrink-0" />{p}</div>)}
                    {opt.cons.map((c) => <div key={c} className="flex items-center gap-1.5 font-mono text-[10px] text-[#415161]"><Circle className="w-2.5 h-2.5 flex-shrink-0" />{c}</div>)}
                  </div>
                  <div>
                    <div className="font-mono text-[8px] text-[#415161] tracking-[0.1em] mb-1">SET IN ENVIRONMENT</div>
                    <CodeBlock copyKey={opt.model} copiedKey={copiedKey} onCopy={copy} code={opt.env} />
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-[#ff990008] border border-[#ff990020] rounded-[3px]">
              <p className="font-mono text-[10px] text-[#415161]">
                <span className="text-[#ff9900]">On Replit:</span> Go to the Secrets tab (🔒) and set <code className="text-[#e8eaf0]">AI_PROVIDER</code> and <code className="text-[#e8eaf0]">AI_MODEL</code>. OpenRouter env vars are automatically provisioned — no key needed.
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OTHER FREE MODELS ON OPENROUTER</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { name: "Llama 3.3 70B", id: "meta-llama/llama-3.3-70b-instruct:free", note: "Best free option" },
                  { name: "Llama 3.2 3B", id: "meta-llama/llama-3.2-3b-instruct:free", note: "Fastest, lightest" },
                  { name: "Hermes 3 405B", id: "nousresearch/hermes-3-llama-3.1-405b:free", note: "Most capable free" },
                ].map((m) => (
                  <button key={m.id} onClick={() => copy(m.id, `model-${m.id}`)} className="text-left p-2.5 bg-[#0f1923] border border-[#1f2f40] hover:border-[#ff990030] rounded-[2px] group transition-all">
                    <div className="font-mono text-[11px] font-bold text-[#9ca3af] group-hover:text-[#e8eaf0]">{m.name}</div>
                    <div className="font-mono text-[9px] text-[#2a3f54] mt-0.5">{m.note}</div>
                    <div className="font-mono text-[8px] text-[#415161] mt-1 truncate">{copiedKey === `model-${m.id}` ? "✓ Copied!" : m.id}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => { mark(2); setCurrent(3); }} className="flex items-center gap-2 px-4 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px]">
                AI Model Configured <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Register Account ── */}
        {current === 3 && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-[#ff9900] flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="font-mono font-bold text-[16px] text-[#e8eaf0]">Register Your AWS Account</h2>
                <p className="font-mono text-[11px] text-[#415161] mt-1">
                  Add your AWS account(s) so alerts are attributed correctly and you can use the Cloud Shell terminal.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="p-4 bg-[#0f1923] border border-[#1f2f40] rounded-[3px] space-y-2">
                <div className="font-mono text-[11px] font-bold text-[#e8eaf0]">Find your AWS Account ID</div>
                <CodeBlock copyKey="get-acct" copiedKey={copiedKey} onCopy={copy} code="aws sts get-caller-identity --query Account --output text" />
              </div>
              <div className="p-4 bg-[#0f1923] border border-[#1f2f40] rounded-[3px] space-y-3">
                <div className="font-mono text-[11px] font-bold text-[#e8eaf0]">IAM permissions Sentinel needs (read-only)</div>
                <p className="font-mono text-[10px] text-[#415161]">For Cloud Shell commands, create an IAM user or role with this policy:</p>
                <CodeBlock
                  copyKey="iam-policy"
                  copiedKey={copiedKey}
                  onCopy={copy}
                  code={`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GuardAIReadOnly",
      "Effect": "Allow",
      "Action": [
        "guardduty:List*", "guardduty:Get*",
        "ec2:Describe*",
        "iam:List*", "iam:Get*",
        "s3:ListAllMyBuckets", "s3:GetBucket*", "s3:GetPublicAccessBlock",
        "cloudtrail:Describe*", "cloudtrail:LookupEvents", "cloudtrail:GetTrailStatus",
        "lambda:List*", "lambda:Get*",
        "logs:Describe*", "logs:FilterLogEvents",
        "rds:Describe*",
        "eks:List*", "eks:Describe*",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}`}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Link href="/accounts">
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#ff9900] hover:underline cursor-pointer">
                  Go to AWS Accounts page →
                </span>
              </Link>
              <button onClick={() => { mark(3); setCurrent(4); }} className="flex items-center gap-2 px-4 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px]">
                Account Registered <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Test ── */}
        {current === 4 && (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-[#ff9900] flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="font-mono font-bold text-[16px] text-[#e8eaf0]">Send a Test Alert</h2>
                <p className="font-mono text-[11px] text-[#415161] mt-1">
                  Verify the full pipeline works end-to-end before going live.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OPTION A — In-app test (easiest)</div>
                <div className="p-3 bg-[#0f1923] border border-[#1f2f40] rounded-[3px] flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[#9ca3af]">Go to Integrations → Test tab → Send Test Alert</span>
                  <Link href="/integrations">
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[10px] rounded-[2px] cursor-pointer">
                      Open <ChevronRight className="w-3 h-3" />
                    </span>
                  </Link>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">OPTION B — Generate a sample GuardDuty finding (AWS CLI)</div>
                <CodeBlock
                  copyKey="sample-finding"
                  copiedKey={copiedKey}
                  onCopy={copy}
                  code={`DETECTOR=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)
aws guardduty create-sample-findings \\
  --detector-id $DETECTOR \\
  --finding-types "UnauthorizedAccess:IAMUser/MaliciousIPCaller"`}
                />
              </div>

              <div className="space-y-2">
                <div className="font-mono text-[10px] text-[#7f9ab0] tracking-[0.1em]">WHAT TO EXPECT</div>
                <div className="space-y-2">
                  {[
                    { time: "0s", event: "GuardDuty generates the finding" },
                    { time: "2–5s", event: "EventBridge routes it to your webhook" },
                    { time: "~5s", event: "Sentinel ingests and begins AI triage" },
                    { time: "~30s", event: "Triage stages complete, verdict generated" },
                    { time: "–", event: "Alert appears in Dashboard and Alert Queue" },
                  ].map((e) => (
                    <div key={e.time} className="flex items-center gap-3 font-mono text-[10px]">
                      <span className="w-12 text-right text-[#ff9900] flex-shrink-0">{e.time}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1f2f40] flex-shrink-0" />
                      <span className="text-[#7f9ab0]">{e.event}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link href="/">
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#415161] hover:text-[#7f9ab0] cursor-pointer">
                  ← Back to Dashboard
                </span>
              </Link>
              <button
                onClick={() => { mark(4); }}
                className="flex items-center gap-2 px-4 py-2 bg-[#1db954] hover:bg-[#1db954]/90 text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px]"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Setup Complete!
              </button>
            </div>
          </div>
        )}
      </div>

      {/* All done banner */}
      {completed.size === STEPS.length && (
        <div className="p-5 bg-[#1db95410] border border-[#1db95430] rounded-[3px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-[#1db954]" />
            <div>
              <div className="font-mono text-[13px] font-bold text-[#1db954]">Setup complete!</div>
              <div className="font-mono text-[10px] text-[#415161]">GuardAI is connected to your AWS environment and ready to triage findings.</div>
            </div>
          </div>
          <Link href="/">
            <span className="flex items-center gap-2 px-4 py-2 bg-[#ff9900] text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px] cursor-pointer hover:bg-[#ff9900]/90">
              Go to Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        </div>
      )}

      {/* Quick reference card */}
      <div className="bg-[#141f2e] border border-[#1f2f40] rounded-[3px] p-5 space-y-3">
        <div className="font-mono text-[10px] text-[#415161] tracking-[0.15em]">QUICK REFERENCE — REQUIRED ENVIRONMENT VARIABLES</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {[
            { key: "DATABASE_URL", note: "Auto-provisioned on Replit" },
            { key: "SESSION_SECRET", note: "Already set" },
            { key: "CLERK_SECRET_KEY", note: "From Clerk dashboard (prod keys)" },
            { key: "VITE_CLERK_PUBLISHABLE_KEY", note: "From Clerk dashboard (prod keys)" },
            { key: "AI_PROVIDER", note: "openrouter (default) or openai" },
            { key: "AI_MODEL", note: "meta-llama/llama-3.3-70b-instruct:free" },
            { key: "AI_INTEGRATIONS_OPENROUTER_BASE_URL", note: "Auto-set on Replit" },
            { key: "AI_INTEGRATIONS_OPENROUTER_API_KEY", note: "Auto-set on Replit" },
          ].map((v) => (
            <div key={v.key} className="flex items-start justify-between gap-2">
              <code className="font-mono text-[10px] text-[#ff9900]">{v.key}</code>
              <span className="font-mono text-[9px] text-[#2a3f54] text-right">{v.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

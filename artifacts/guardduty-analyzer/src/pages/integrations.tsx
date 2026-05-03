/**
 * Integrations — AWS GuardDuty Console-style
 *
 * Sections:
 *  1. Connection status card (seamless at-a-glance)
 *  2. Endpoint + token config
 *  3. Step-by-step setup wizard (EventBridge / SNS / CLI / Test)
 *  4. Live Event Feed (SSE)
 *  5. Debug Logs (integration-level logs with level filter)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Copy, Check, Eye, EyeOff, Zap, Activity, Terminal,
  Cloud, Webhook, RefreshCw, Play, Loader2, CheckCircle2,
  XCircle, ArrowRight, ChevronRight, AlertTriangle, Info,
  BugPlay, FileText, Filter, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAlertStatsQueryKey, getListAlertsQueryKey } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Design tokens (AWS Console palette) ─────────────────────────────────────
const T = {
  bg:      "var(--cs-bg)",
  surface: "var(--cs-surface)",
  surface2:"var(--cs-surface2)",
  border:  "var(--cs-border)",
  border2: "var(--cs-border2)",
  text:    "var(--cs-text)",
  dim:     "var(--cs-text-dim)",
  muted:   "var(--cs-text-muted)",
  orange:  "var(--cs-orange)",
  blue:    "#00a8e6",
  green:   "#1db954",
  red:     "#f14c4c",
  yellow:  "#f5c518",
  mono:    "'JetBrains Mono', monospace",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntegrationConfig {
  webhookUrl: string;
  webhookToken: string;
  autoTriageEnabled: boolean;
  sseEndpoint: string;
}

interface LiveEvent {
  id: string;
  ts: number;
  type: string;
  data: Record<string, unknown>;
}

interface DebugLog {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  event: string;
  detail: string;
  requestId?: string;
}

type SetupTab = "eventbridge" | "sns" | "cli" | "test";
type TestStatus = "idle" | "firing" | "analyzing" | "triaging" | "done" | "error";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast({ title: "Copied to clipboard" });
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] font-mono transition-all"
      style={{
        background: copied ? `${T.green}20` : `${T.border2}`,
        color: copied ? T.green : T.dim,
        border: `1px solid ${copied ? T.green + "50" : T.border2}`,
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </button>
  );
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: T.muted }}>{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 overflow-x-auto text-[11px] leading-relaxed" style={{ background: "var(--cs-bg)", fontFamily: T.mono }}>
        <code style={{ color: "#9bbccc" }}>{code}</code>
      </pre>
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: connected ? `${T.green}15` : "var(--cs-surface2)", border: `1px solid ${connected ? T.green + "40" : "var(--cs-border)"}` }}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "animate-pulse" : ""}`} style={{ background: connected ? T.green : "var(--cs-text-muted)" }} />
      <span className="text-[10px] font-mono font-semibold" style={{ color: connected ? T.green : T.dim }}>
        {connected ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}

const LOG_LEVEL_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  info:  { color: T.blue,   bg: `${T.blue}15`,  label: "INFO" },
  debug: { color: T.dim,    bg: "var(--cs-surface2)",  label: "DEBUG" },
  warn:  { color: T.yellow, bg: `${T.yellow}15`,label: "WARN" },
  error: { color: T.red,    bg: `${T.red}15`,   label: "ERROR" },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function Integrations() {
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [setupTab, setSetupTab] = useState<SetupTab>("eventbridge");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testResult, setTestResult] = useState<{ alertId?: number; verdict?: string; verdictConfidence?: number } | null>(null);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [logFilter, setLogFilter] = useState<"all" | "info" | "warn" | "error" | "debug">("all");
  const [activeSection, setActiveSection] = useState<"setup" | "feed" | "logs">("setup");
  const sseRef = useRef<EventSource | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Load config
  useEffect(() => {
    fetch(`${BASE_URL}/api/integrations/config`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setConfig(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Fetch debug logs
  const fetchDebugLogs = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/api/integrations/logs`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json() as { logs: DebugLog[] };
        setDebugLogs(d.logs);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void fetchDebugLogs(); }, [fetchDebugLogs]);

  // SSE live feed
  useEffect(() => {
    const es = new EventSource(`${BASE_URL}/api/alerts/stream`, { withCredentials: true });
    sseRef.current = es;
    es.addEventListener("connected", () => setSseConnected(true));
    es.addEventListener("new-alert", (e) => {
      const data = JSON.parse(e.data) as { alertId?: number; title?: string; severity?: string; source?: string };
      setLiveEvents(prev => [{ id: crypto.randomUUID(), ts: Date.now(), type: "new-alert", data }, ...prev.slice(0, 49)]);
      queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      if (data.source === "test") {
        setTestStatus("triaging");
        setTestLog(l => [...l, `✓ Alert #${data.alertId} created — triage pipeline starting…`]);
      } else {
        toast({ title: `New Finding: ${data.title ?? "GuardDuty"}`, description: `Severity: ${data.severity ?? "?"} · Triage starting…` });
      }
      void fetchDebugLogs();
    });
    es.addEventListener("triage-complete", (e) => {
      const data = JSON.parse(e.data) as { alertId?: number; verdict?: string; verdictConfidence?: number };
      setLiveEvents(prev => [{ id: crypto.randomUUID(), ts: Date.now(), type: "triage-complete", data }, ...prev.slice(0, 49)]);
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      setTestStatus(prev => prev === "triaging" ? "done" : prev);
      setTestResult(prev => prev?.alertId === data.alertId ? { ...prev, verdict: data.verdict, verdictConfidence: data.verdictConfidence } : prev);
      setTestLog(l => [...l, `✓ Triage complete → ${data.verdict} (${data.verdictConfidence}% confidence)`]);
      void fetchDebugLogs();
    });
    es.onerror = () => setSseConnected(false);
    return () => { es.close(); setSseConnected(false); };
  }, [queryClient, toast, fetchDebugLogs]);

  const fireTest = useCallback(async () => {
    setTestStatus("firing");
    setTestLog(["→ Sending test GuardDuty finding to webhook…"]);
    setTestResult(null);
    try {
      const r = await fetch(`${BASE_URL}/api/integrations/test`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTestStatus("analyzing");
      setTestLog(l => [...l, "✓ Finding received — AI analysis running…"]);
      void fetchDebugLogs();
    } catch (err) {
      setTestStatus("error");
      setTestLog(l => [...l, `✗ Error: ${err instanceof Error ? err.message : String(err)}`]);
      void fetchDebugLogs();
    }
  }, [fetchDebugLogs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2" style={{ color: T.dim }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="font-mono text-[11px]">Loading integration config…</span>
        </div>
      </div>
    );
  }

  const token = config?.webhookToken ?? "";
  const maskedToken = token.slice(0, 8) + "•".repeat(Math.max(0, token.length - 8));
  const webhookUrl = config?.webhookUrl ?? `${window.location.origin}/api/integrations/guardduty/webhook`;

  const eventbridgeCli = `# 1. Create an EventBridge Connection (API Key auth)
aws events create-connection \\
  --name "guardai-connection" \\
  --authorization-type API_KEY \\
  --auth-parameters '{
    "ApiKeyAuthParameters": {
      "ApiKeyName": "X-GuardAI-Token",
      "ApiKeyValue": "${token}"
    }
  }'

# 2. Create an API Destination
aws events create-api-destination \\
  --name "guardai-guardduty" \\
  --connection-arn <CONNECTION_ARN_FROM_STEP_1> \\
  --invocation-endpoint "${webhookUrl}" \\
  --http-method POST \\
  --invocation-rate-limit-per-second 300

# 3. Create EventBridge Rule (GuardDuty source)
aws events put-rule \\
  --name "GuardDuty-to-GuardAI" \\
  --event-pattern '{"source":["aws.guardduty"]}' \\
  --state ENABLED

# 4. Add the API Destination as a target
aws events put-targets \\
  --rule "GuardDuty-to-GuardAI" \\
  --targets '[{
    "Id": "1",
    "Arn": "<API_DESTINATION_ARN_FROM_STEP_2>",
    "RoleArn": "<EVENTBRIDGE_EXECUTION_ROLE_ARN>"
  }]'`;

  const snsCli = `# 1. Create an SNS topic
aws sns create-topic --name guardai-guardduty

# 2. Subscribe the GuardAI webhook as an HTTPS endpoint
aws sns subscribe \\
  --topic-arn <TOPIC_ARN> \\
  --protocol https \\
  --notification-endpoint "${webhookUrl}"

# Note: Add "X-GuardAI-Token: ${token}" as a delivery policy header.
# GuardAI will confirm the subscription automatically.

# 3. Route GuardDuty findings to SNS
aws events put-rule \\
  --name GuardDuty-to-SNS \\
  --event-pattern '{"source":["aws.guardduty"]}' \\
  --state ENABLED

aws events put-targets \\
  --rule GuardDuty-to-SNS \\
  --targets '[{"Id":"1","Arn":"<TOPIC_ARN>"}]'`;

  const testCurl = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-GuardAI-Token: ${token}" \\
  -d '{
    "schemaVersion": "2.0",
    "accountId": "123456789012",
    "region": "us-east-1",
    "id": "test-finding-001",
    "type": "UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B",
    "severity": 8,
    "title": "Unusual console login from anonymous proxy",
    "description": "IAM user logged into AWS Console from a Tor exit node.",
    "resource": {
      "resourceType": "AccessKey",
      "accessKeyDetails": {
        "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
        "userType": "IAMUser",
        "userName": "TestUser"
      }
    }
  }'`;

  const filteredLogs = logFilter === "all" ? debugLogs : debugLogs.filter(l => l.level === logFilter);
  const errorCount = debugLogs.filter(l => l.level === "error").length;
  const warnCount = debugLogs.filter(l => l.level === "warn").length;

  return (
    <div className="max-w-5xl space-y-0 pb-12">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: T.text }}>Integrations</h1>
          <p className="text-[12px] mt-0.5" style={{ color: T.dim }}>Connect AWS GuardDuty for real-time finding ingestion and AI auto-triage</p>
        </div>
        <StatusPill connected={sseConnected} />
      </div>

      {/* ── Connection status banner ── */}
      <div className="rounded-sm mb-5 overflow-hidden" style={{ border: `1px solid ${sseConnected ? T.green + "40" : T.border}`, background: sseConnected ? `${T.green}08` : T.surface }}>
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0" style={{ background: `${T.orange}15`, border: `1px solid ${T.orange}30` }}>
            <Cloud className="w-5 h-5" style={{ color: T.orange }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[13px]" style={{ color: T.text }}>AWS GuardDuty → GuardAI</span>
              {sseConnected && (
                <span className="text-[9px] font-mono font-bold px-1.5 py-[2px] rounded-sm" style={{ background: `${T.green}20`, color: T.green, border: `1px solid ${T.green}40` }}>
                  CONNECTED
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: T.dim }}>
              EventBridge routes findings → Webhook → AI triage (5 stages) → Alert queue
            </p>
          </div>

          {/* Flow diagram */}
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            {[
              { icon: Cloud,   label: "GuardDuty",  sub: "Finding" },
              { icon: Activity,label: "EventBridge",sub: "Routes" },
              { icon: Webhook, label: "GuardAI",    sub: "Receives" },
              { icon: Zap,     label: "AI Triage",  sub: "5 stages" },
            ].map(({ icon: Icon, label, sub }, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-7 h-7 rounded-sm flex items-center justify-center" style={{ background: T.surface2, border: `1px solid ${T.border2}` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: T.orange }} />
                  </div>
                  <span className="text-[8px] font-mono" style={{ color: T.muted }}>{label}</span>
                </div>
                {i < 3 && <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: T.muted }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Credentials card ── */}
      <div className="rounded-sm mb-5" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="px-5 py-3" style={{ borderBottom: `1px solid ${T.border}` }}>
          <span className="text-[12px] font-semibold" style={{ color: T.text }}>Connection credentials</span>
        </div>
        <div className="p-5 grid grid-cols-1 gap-4">
          {/* Webhook URL */}
          <div>
            <label className="text-[10px] font-mono font-semibold uppercase tracking-widest block mb-1.5" style={{ color: T.dim }}>
              Webhook endpoint
            </label>
            <div className="flex items-center gap-2 rounded-sm px-3 py-2.5" style={{ background: T.bg, border: `1px solid ${T.border2}` }}>
              <span className="flex-1 font-mono text-[12px] truncate" style={{ color: T.text }}>{webhookUrl}</span>
              <CopyButton text={webhookUrl} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: T.muted }}>HTTPS endpoint to receive GuardDuty findings via EventBridge or SNS</p>
          </div>

          {/* Token */}
          <div>
            <label className="text-[10px] font-mono font-semibold uppercase tracking-widest block mb-1.5" style={{ color: T.dim }}>
              X-GuardAI-Token header
            </label>
            <div className="flex items-center gap-2 rounded-sm px-3 py-2.5" style={{ background: T.bg, border: `1px solid ${T.border2}` }}>
              <span className="flex-1 font-mono text-[12px] truncate" style={{ color: T.text }}>
                {showToken ? token : maskedToken}
              </span>
              <button onClick={() => setShowToken(v => !v)} className="p-1 rounded-sm transition-colors" style={{ color: T.muted }}>
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <CopyButton text={token} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: T.muted }}>
              Set as <code className="font-mono px-1" style={{ background: T.surface2, color: T.orange }}>X-GuardAI-Token</code> in your EventBridge API Destination connection. Legacy <code className="font-mono px-1" style={{ background: T.surface2, color: T.dim }}>X-Sentinel-Token</code> is also accepted.
            </p>
          </div>
        </div>
      </div>

      {/* ── Section tabs ── */}
      <div className="flex items-center mb-0" style={{ borderBottom: `1px solid ${T.border}` }}>
        {([
          { id: "setup" as const, label: "Setup",          icon: Webhook, dot: false as boolean,        badge: null as number|null, badgeColor: "" },
          { id: "feed"  as const, label: "Live Event Feed", icon: Activity, dot: sseConnected,           badge: null as number|null, badgeColor: "" },
          { id: "logs"  as const, label: "Debug Logs",      icon: BugPlay,  dot: false as boolean, badge: errorCount > 0 ? errorCount : warnCount > 0 ? warnCount : null, badgeColor: errorCount > 0 ? T.red : T.yellow },
        ]).map(({ id, label, icon: Icon, dot, badge, badgeColor }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className="flex items-center gap-1.5 px-4 pb-2.5 pt-1 text-[12px] font-medium border-b-2 transition-all"
            style={{
              borderColor: activeSection === id ? T.orange : "transparent",
              color: activeSection === id ? T.orange : T.dim,
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {dot && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: T.green }} />}
            {badge != null && (
              <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-sm" style={{ background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Setup tab ── */}
      {activeSection === "setup" && (
        <div className="rounded-sm overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}`, borderTop: "none", borderRadius: "0 0 2px 2px" }}>
          {/* Sub-tabs */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-0" style={{ borderBottom: `1px solid ${T.border}` }}>
            {(["eventbridge", "sns", "cli", "test"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSetupTab(tab)}
                className="px-3 pb-2.5 text-[11px] font-mono uppercase tracking-wider border-b-2 transition-colors"
                style={{
                  borderColor: setupTab === tab ? T.blue : "transparent",
                  color: setupTab === tab ? T.blue : T.muted,
                }}
              >
                {tab === "eventbridge" ? "EventBridge" : tab === "sns" ? "SNS" : tab === "cli" ? "AWS CLI" : "Test"}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {setupTab === "eventbridge" && (
              <>
                <div className="flex items-start gap-2 p-3 rounded-sm" style={{ background: `${T.blue}10`, border: `1px solid ${T.blue}25` }}>
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: T.blue }} />
                  <p className="text-[11px]" style={{ color: T.dim }}>
                    <strong style={{ color: T.text }}>Recommended.</strong> EventBridge API Destination delivers findings in real time with automatic retry and dead-letter queue support. Requires an EventBridge execution role with <code className="font-mono px-1" style={{ background: T.surface2 }}>events:InvokeApiDestination</code> permission.
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    { n: 1, title: "Open EventBridge → Connections", desc: 'Create a new connection. Auth type: API Key. Key name: "X-GuardAI-Token". Key value: your token above.' },
                    { n: 2, title: "Create an API Destination", desc: `Endpoint: ${webhookUrl} · Method: POST · Rate limit: 300/s` },
                    { n: 3, title: "Create a Rule", desc: 'Event pattern: {"source": ["aws.guardduty"]} · State: Enabled' },
                    { n: 4, title: "Add the API Destination as target", desc: "Select the API Destination ARN. Attach your execution role. Save." },
                    { n: 5, title: "Test the connection", desc: 'Switch to the "Test" tab above and fire a synthetic finding to confirm end-to-end flow.' },
                  ].map(({ n, title, desc }) => (
                    <div key={n} className="flex gap-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold" style={{ background: `${T.orange}20`, color: T.orange, border: `1px solid ${T.orange}40` }}>
                        {n}
                      </div>
                      <div>
                        <div className="text-[12px] font-medium" style={{ color: T.text }}>{title}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: T.dim }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-1">
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: T.muted }}>AWS CLI equivalent</div>
                  <CodeBlock code={eventbridgeCli} lang="bash" />
                </div>
              </>
            )}

            {setupTab === "sns" && (
              <>
                <div className="flex items-start gap-2 p-3 rounded-sm" style={{ background: `${T.yellow}10`, border: `1px solid ${T.yellow}25` }}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: T.yellow }} />
                  <p className="text-[11px]" style={{ color: T.dim }}>
                    SNS does not natively support custom headers. GuardAI falls back to checking the <code className="font-mono px-1" style={{ background: T.surface2 }}>X-GuardAI-Token</code> query parameter or accepting the SNS subscription confirmation automatically. Prefer EventBridge for production.
                  </p>
                </div>
                <CodeBlock code={snsCli} lang="bash" />
              </>
            )}

            {setupTab === "cli" && (
              <>
                <p className="text-[11px]" style={{ color: T.dim }}>Run the complete EventBridge setup in one shot. Requires IAM permissions for EventBridge, plus an execution role that can invoke API Destinations.</p>
                <CodeBlock code={eventbridgeCli} lang="bash" />
              </>
            )}

            {setupTab === "test" && (
              <div className="space-y-4">
                <p className="text-[11px]" style={{ color: T.dim }}>
                  Fire a synthetic GuardDuty finding and watch the full AI triage pipeline run in real time. The finding appears in your Alert Queue when complete.
                </p>

                <button
                  onClick={() => void fireTest()}
                  disabled={testStatus === "firing" || testStatus === "analyzing" || testStatus === "triaging"}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-sm font-semibold text-[13px] tracking-wide transition-all"
                  style={{
                    background: ["idle","done","error"].includes(testStatus) ? T.orange : `${T.orange}20`,
                    color: ["idle","done","error"].includes(testStatus) ? "#000" : T.orange,
                    border: `1px solid ${T.orange}60`,
                    cursor: ["firing","analyzing","triaging"].includes(testStatus) ? "not-allowed" : "pointer",
                    opacity: ["firing","analyzing","triaging"].includes(testStatus) ? 0.7 : 1,
                  }}
                >
                  {["idle","done","error"].includes(testStatus) ? (
                    <><Play className="w-4 h-4" /> Fire test finding</>
                  ) : (
                    <><Loader2 className="w-4 h-4 animate-spin" /> {testStatus === "firing" ? "Sending…" : testStatus === "analyzing" ? "AI analyzing…" : "Triage running…"}</>
                  )}
                </button>

                {/* Pipeline log */}
                {testLog.length > 0 && (
                  <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
                    <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                      <Terminal className="w-3 h-3" style={{ color: T.muted }} />
                      <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: T.muted }}>Pipeline log</span>
                      {["analyzing","triaging"].includes(testStatus) && <span className="w-1.5 h-1.5 rounded-full bg-[#1db954] animate-pulse" />}
                    </div>
                    <div className="p-3 space-y-1.5" style={{ background: "var(--cs-bg)", fontFamily: T.mono }}>
                      {testLog.map((line, i) => (
                        <div key={i} className="text-[11px]" style={{ color: line.startsWith("✗") ? T.red : line.startsWith("✓") ? T.green : T.dim }}>
                          {line}
                        </div>
                      ))}
                      {["analyzing","triaging"].includes(testStatus) && (
                        <div className="flex items-center gap-2 text-[11px]" style={{ color: T.muted }}>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>{testStatus === "analyzing" ? "Analyzing with AI model…" : "Agent iterating — investigating confidence…"}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {testStatus === "done" && testResult && (
                  <div className="flex items-center justify-between p-3 rounded-sm" style={{ background: `${T.green}08`, border: `1px solid ${T.green}30` }}>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" style={{ color: T.green }} />
                      <span className="text-[12px]" style={{ color: T.text }}>
                        Verdict: <span className="font-semibold" style={{ color: T.orange }}>{testResult.verdict}</span>
                        {testResult.verdictConfidence && <span style={{ color: T.dim }}> · {testResult.verdictConfidence}% confidence</span>}
                      </span>
                    </div>
                    {testResult.alertId && (
                      <button onClick={() => navigate(`/alerts/${testResult.alertId}`)} className="flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-70" style={{ color: T.blue }}>
                        View alert <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                {testStatus === "error" && (
                  <div className="flex items-center gap-2 p-3 rounded-sm" style={{ background: `${T.red}10`, border: `1px solid ${T.red}30` }}>
                    <XCircle className="w-4 h-4" style={{ color: T.red }} />
                    <span className="text-[11px]" style={{ color: T.red }}>Test failed. Check that you are signed in and the API server is running. See Debug Logs tab for details.</span>
                  </div>
                )}

                <div className="pt-2" style={{ borderTop: `1px solid ${T.border}` }}>
                  <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: T.muted }}>Manual curl equivalent</div>
                  <CodeBlock code={testCurl} lang="curl" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Live Feed tab ── */}
      {activeSection === "feed" && (
        <div className="rounded-sm overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}`, borderTop: "none", borderRadius: "0 0 2px 2px" }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${T.border}`, background: T.bg }}>
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" style={{ color: T.muted }} />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: T.dim }}>
                Live Event Feed
              </span>
              {sseConnected && <span className="w-1.5 h-1.5 rounded-full bg-[#1db954] animate-pulse" />}
              <span className="font-mono text-[9px]" style={{ color: T.muted }}>{liveEvents.length} events</span>
            </div>
            <button onClick={() => setLiveEvents([])} className="flex items-center gap-1 text-[10px] font-mono transition-opacity hover:opacity-70" style={{ color: T.muted }}>
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          </div>
          <div className="min-h-[160px] max-h-[420px] overflow-y-auto" style={{ background: "var(--cs-bg)", fontFamily: T.mono }}>
            {liveEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <Activity className="w-5 h-5" style={{ color: T.muted + "60" }} />
                <span className="text-[11px]" style={{ color: T.muted }}>Waiting for GuardDuty findings…</span>
                <span className="text-[9px]" style={{ color: T.muted + "80" }}>Fire a test finding from the Setup tab to see events here</span>
              </div>
            ) : (
              liveEvents.map(ev => {
                const isNew = ev.type === "new-alert";
                const isDone = ev.type === "triage-complete";
                return (
                  <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5 transition-colors" style={{ borderBottom: `1px solid var(--cs-bg)` }}>
                    <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: T.muted }}>
                      {new Date(ev.ts).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                    <span className="text-[10px] font-bold flex-shrink-0 px-1.5 py-[1px] rounded-sm" style={{
                      color: isNew ? T.blue : isDone ? T.green : T.dim,
                      background: isNew ? `${T.blue}15` : isDone ? `${T.green}15` : `${T.muted}15`,
                    }}>
                      {isNew ? "NEW ALERT" : isDone ? "TRIAGE DONE" : ev.type.toUpperCase()}
                    </span>
                    <span className="text-[11px] flex-1 truncate" style={{ color: T.dim }}>
                      {isNew
                        ? `${ev.data.title ?? "Finding"} · ${ev.data.severity ?? "?"} · Source: ${ev.data.source ?? "webhook"}`
                        : isDone
                          ? `Alert #${ev.data.alertId} → ${ev.data.verdict} (${ev.data.verdictConfidence}%)`
                          : JSON.stringify(ev.data).slice(0, 80)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Debug Logs tab ── */}
      {activeSection === "logs" && (
        <div className="rounded-sm overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}`, borderTop: "none", borderRadius: "0 0 2px 2px" }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${T.border}`, background: T.bg }}>
            <div className="flex items-center gap-3">
              <FileText className="w-3.5 h-3.5" style={{ color: T.muted }} />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: T.dim }}>Debug Logs</span>
              <span className="font-mono text-[9px]" style={{ color: T.muted }}>{filteredLogs.length} entries</span>
              {errorCount > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-sm" style={{ background: `${T.red}20`, color: T.red, border: `1px solid ${T.red}40` }}>
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </span>
              )}
              {warnCount > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-sm" style={{ background: `${T.yellow}20`, color: T.yellow, border: `1px solid ${T.yellow}40` }}>
                  {warnCount} warn{warnCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Level filter */}
              <div className="flex items-center gap-1">
                <Filter className="w-3 h-3" style={{ color: T.muted }} />
                <select
                  value={logFilter}
                  onChange={e => setLogFilter(e.target.value as typeof logFilter)}
                  className="text-[10px] font-mono rounded-sm px-2 py-1 outline-none"
                  style={{ background: T.surface2, border: `1px solid ${T.border2}`, color: T.dim }}
                >
                  <option value="all">All levels</option>
                  <option value="error">Error</option>
                  <option value="warn">Warn</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
              </div>
              <button onClick={() => void fetchDebugLogs()} className="flex items-center gap-1 text-[10px] font-mono transition-opacity hover:opacity-70" style={{ color: T.dim }}>
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
              <button onClick={() => setDebugLogs([])} className="flex items-center gap-1 text-[10px] font-mono transition-opacity hover:opacity-70" style={{ color: T.muted }}>
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </div>
          </div>

          <div className="min-h-[200px] max-h-[520px] overflow-y-auto" style={{ background: "var(--cs-bg)", fontFamily: T.mono }}>
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <BugPlay className="w-5 h-5" style={{ color: T.muted + "60" }} />
                <span className="text-[11px]" style={{ color: T.muted }}>
                  {debugLogs.length === 0 ? "No integration events recorded yet" : `No ${logFilter} logs`}
                </span>
                <span className="text-[9px]" style={{ color: T.muted + "80" }}>
                  Events are logged as GuardDuty findings arrive via webhook
                </span>
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {["Time", "Level", "Event", "Request ID", "Detail"].map(h => (
                      <th key={h} className="px-4 py-2 text-left font-mono text-[9px] uppercase tracking-widest" style={{ color: T.muted, background: "var(--cs-bg)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, i) => {
                    const style = LOG_LEVEL_STYLE[log.level] ?? LOG_LEVEL_STYLE.info!;
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid var(--cs-bg)` }}>
                        <td className="px-4 py-2 whitespace-nowrap" style={{ color: T.muted }}>
                          {new Date(log.ts).toLocaleTimeString("en-US", { hour12: false })}
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-bold text-[9px] px-1.5 py-[2px] rounded-sm" style={{ color: style.color, background: style.bg }}>
                            {style.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: style.color }}>
                          {log.event}
                        </td>
                        <td className="px-4 py-2 font-mono text-[9px]" style={{ color: T.muted }}>
                          {log.requestId ?? "—"}
                        </td>
                        <td className="px-4 py-2 max-w-[360px] truncate" style={{ color: T.dim }} title={log.detail}>
                          {log.detail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

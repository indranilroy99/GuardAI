/**
 * Incidents — Two-panel kill-chain timeline view
 *
 * Left: auto-correlated incident list (grouping by MITRE tactic / resource / account)
 * Right: selected incident timeline with AI analyst narrative, kill-chain progression,
 *        vertical event log, and affected-resource summary.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useListAlerts } from "@workspace/api-client-react";
import {
  Siren, ChevronRight, Clock, Shield, AlertTriangle, Flame,
  TrendingUp, Loader2, Crosshair, RefreshCw, User2, Target,
  Server, MapPin, ChevronDown, ChevronUp, Zap,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface Alert {
  id: number;
  title: string;
  severity: string;
  type: string;
  accountId: string;
  region: string;
  mitreAttackTactic: string;
  mitreAttackTechniqueId: string;
  mitreAttackTechnique: string;
  affectedResource: string;
  resourceType: string;
  createdAt: string;
  triageStatus: string;
  verdict: string | null;
  verdictConfidence: number | null;
  remediationStatus: string;
}

interface Incident {
  id: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  alertIds: number[];
  alerts: Alert[];
  reason: string;
  tactic: string;
  accountId: string;
  region: string;
  firstSeen: string;
  lastSeen: string;
  status: "active" | "investigating" | "resolved";
}

interface TimelineStage {
  tactic: string;
  phaseIndex: number;
  alerts: Alert[];
  maxSeverity: string;
}

interface TimelineResource {
  resource: string;
  alerts: number;
  topSeverity: string;
}

interface Narrative {
  headline: string;
  attackerProfile: string;
  objective: string;
  currentPhase: string;
  riskScore: number;
  narrative: string;
  responseActions: string[];
}

interface TimelineData {
  alerts: Alert[];
  stages: TimelineStage[];
  resources: TimelineResource[];
  narrative: Narrative | null;
  meta: {
    totalAlerts: number;
    firstSeen: string | null;
    lastSeen: string | null;
    uniqueTactics: number;
    uniqueResources: number;
    accounts: string[];
    regions: string[];
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEV_ORDER: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const SEV_STYLE: Record<string, { bg: string; border: string; text: string; dot: string; ring: string }> = {
  CRITICAL: { bg: "#ff1a1a0e", border: "#ff1a1a30", text: "#f14c4c", dot: "#f14c4c", ring: "#f14c4c" },
  HIGH:     { bg: "#ff6b000e", border: "#ff6b0030", text: "#ff8533", dot: "#ff6b00", ring: "#ff6b00" },
  MEDIUM:   { bg: "#f59e0b0e", border: "#f59e0b30", text: "#fbbf24", dot: "#f59e0b", ring: "#f59e0b" },
  LOW:      { bg: "#3b82f60e", border: "#3b82f630", text: "#60a5fa", dot: "#3b82f6", ring: "#3b82f6" },
};

const PHASE_ORDER = [
  "Reconnaissance", "Resource Development", "Initial Access", "Execution",
  "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access",
  "Discovery", "Lateral Movement", "Collection", "Command and Control",
  "Exfiltration", "Impact",
];

const PHASE_SHORT: Record<string, string> = {
  "Reconnaissance": "RECON", "Resource Development": "RES DEV", "Initial Access": "INIT ACC",
  "Execution": "EXEC", "Persistence": "PERSIST", "Privilege Escalation": "PRIV ESC",
  "Defense Evasion": "DEF EVA", "Credential Access": "CRED ACC", "Discovery": "DISCOV",
  "Lateral Movement": "LAT MOV", "Collection": "COLLECT", "Command and Control": "C2",
  "Exfiltration": "EXFIL", "Impact": "IMPACT",
};

// Phase colour (early = teal, mid = amber, late = red)
function phaseColor(phase: string): string {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 3) return "var(--cs-orange)";
  if (idx < 7) return "#f59e0b";
  if (idx < 11) return "#f97316";
  return "#ef4444";
}

// ─── Correlation ──────────────────────────────────────────────────────────────

function maxSev(alerts: Alert[]): Incident["severity"] {
  return alerts.reduce(
    (best, a) => (SEV_ORDER[a.severity]! > SEV_ORDER[best]! ? a.severity : best),
    "LOW"
  ) as Incident["severity"];
}

function correlateAlerts(alerts: Alert[]): Incident[] {
  const incidents: Incident[] = [];
  const used = new Set<number>();

  // 1. Same account + MITRE tactic within 7 days
  const byAccountTactic = new Map<string, Alert[]>();
  for (const a of alerts) {
    const key = `${a.accountId}::${a.mitreAttackTactic}`;
    if (!byAccountTactic.has(key)) byAccountTactic.set(key, []);
    byAccountTactic.get(key)!.push(a);
  }
  for (const [key, group] of byAccountTactic) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const span = new Date(sorted[sorted.length - 1]!.createdAt).getTime() - new Date(sorted[0]!.createdAt).getTime();
    if (span > 7 * 86400000) continue;
    const g = sorted.filter((a) => !used.has(a.id));
    if (g.length < 2) continue;
    g.forEach((a) => used.add(a.id));
    const [accountId, tactic] = key.split("::");
    incidents.push({
      id: `tactic-${key}`,
      title: `${tactic} Campaign`,
      severity: maxSev(g),
      alertIds: g.map((a) => a.id),
      alerts: g,
      reason: `${g.length} alerts share the same MITRE tactic across account ${accountId}`,
      tactic: tactic ?? "",
      accountId: accountId ?? "",
      region: g[0]?.region ?? "",
      firstSeen: g[0]!.createdAt,
      lastSeen: g[g.length - 1]!.createdAt,
      status: g.some((a) => a.triageStatus === "running") ? "investigating" : "active",
    });
  }

  // 2. Same affected resource (≥2 alerts)
  const byResource = new Map<string, Alert[]>();
  for (const a of alerts) {
    if (used.has(a.id)) continue;
    if (!byResource.has(a.affectedResource)) byResource.set(a.affectedResource, []);
    byResource.get(a.affectedResource)!.push(a);
  }
  for (const [resource, group] of byResource) {
    if (group.length < 2) continue;
    const g = group.filter((a) => !used.has(a.id));
    if (g.length < 2) continue;
    g.forEach((a) => used.add(a.id));
    const sorted = [...g].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    incidents.push({
      id: `resource-${resource}`,
      title: `Attack on ${resource.split("/").pop() ?? resource}`,
      severity: maxSev(g),
      alertIds: g.map((a) => a.id),
      alerts: g,
      reason: `${g.length} alerts targeting the same resource`,
      tactic: g[0]?.mitreAttackTactic ?? "",
      accountId: g[0]?.accountId ?? "",
      region: g[0]?.region ?? "",
      firstSeen: sorted[0]!.createdAt,
      lastSeen: sorted[sorted.length - 1]!.createdAt,
      status: "active",
    });
  }

  // 3. Critical singletons
  for (const a of alerts) {
    if (used.has(a.id) || a.severity !== "CRITICAL") continue;
    used.add(a.id);
    incidents.push({
      id: `critical-${a.id}`,
      title: a.title.length > 60 ? a.title.slice(0, 58) + "…" : a.title,
      severity: "CRITICAL",
      alertIds: [a.id],
      alerts: [a],
      reason: "Critical severity alert — escalated to incident",
      tactic: a.mitreAttackTactic,
      accountId: a.accountId,
      region: a.region,
      firstSeen: a.createdAt,
      lastSeen: a.createdAt,
      status: a.verdict ? "investigating" : "active",
    });
  }

  return incidents.sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function durationStr(first: string, last: string) {
  const ms = new Date(last).getTime() - new Date(first).getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  return `${Math.floor(ms / 86400000)}d`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SevBadge({ sev }: { sev: string }) {
  const s = SEV_STYLE[sev] ?? SEV_STYLE.LOW!;
  return (
    <span
      className="font-mono text-[9px] font-bold px-1.5 py-[2px] rounded-[2px] tracking-wider"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {sev}
    </span>
  );
}

function KillChainBar({ activeTactics }: { activeTactics: Set<string> }) {
  return (
    <div className="flex gap-px">
      {PHASE_ORDER.map((phase) => {
        const active = activeTactics.has(phase);
        const color = phaseColor(phase);
        return (
          <div
            key={phase}
            className="flex-1 flex flex-col items-center gap-1 py-1.5 transition-all"
            style={{
              backgroundColor: active ? `${color}15` : "var(--cs-bg)",
              borderBottom: active ? `2px solid ${color}` : "2px solid var(--cs-surface)",
            }}
            title={phase}
          >
            <span className="font-mono text-[6px] tracking-wide" style={{ color: active ? color : "var(--cs-border2)" }}>
              {PHASE_SHORT[phase]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NarrativeCard({ narrative }: { narrative: Narrative }) {
  const [expanded, setExpanded] = useState(false);
  const riskColor = narrative.riskScore >= 80 ? "#f14c4c" : narrative.riskScore >= 60 ? "#f97316" : narrative.riskScore >= 40 ? "#f59e0b" : "#1db954";

  return (
    <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--cs-surface)] hover:bg-[var(--cs-surface2)] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]" />
            <span className="font-mono text-[10px] font-bold text-[var(--cs-text-dim)] tracking-[0.1em]">AI ANALYST REPORT</span>
          </div>
          <span className="font-mono text-[9px] px-1.5 py-[1px] rounded-[2px] bg-[#8b5cf620] border border-[#8b5cf640]" style={{ color: "#a78bfa" }}>
            {narrative.attackerProfile}
          </span>
          <span className="font-mono text-[9px] px-1.5 py-[1px] rounded-[2px] bg-[#ff990010] border border-[#ff990030] text-[#ff9900]">
            {narrative.objective}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">RISK</span>
            <span className="font-mono text-[14px] font-bold" style={{ color: riskColor }}>{narrative.riskScore}</span>
          </div>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-4 space-y-4 bg-[var(--cs-bg)] border-t border-[var(--cs-border)]">
          {/* Narrative */}
          <div>
            <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.1em] mb-2">ANALYST NARRATIVE</div>
            <p className="font-mono text-[11px] text-[var(--cs-text-dim)] leading-[1.8] whitespace-pre-wrap">{narrative.narrative}</p>
          </div>

          {/* Response actions */}
          <div>
            <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.1em] mb-2">RECOMMENDED ACTIONS</div>
            <ol className="space-y-1.5">
              {narrative.responseActions.map((action, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="font-mono text-[9px] text-[#ff9900] font-bold flex-shrink-0 mt-[1px]">{i + 1}.</span>
                  <span className="font-mono text-[11px] text-[var(--cs-text-dim)]">{action}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentTimeline({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE_URL}/api/incidents/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ alertIds: incident.alertIds }),
      });
      if (!r.ok) throw new Error("Failed to load timeline");
      setData(await r.json() as TimelineData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [incident.alertIds]);

  // Load whenever the incident changes
  useEffect(() => { void load(); }, [incident.id, load]);

  const style = SEV_STYLE[incident.severity] ?? SEV_STYLE.LOW!;
  const activeTactics = new Set(data?.stages.map((s) => s.tactic) ?? []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: style.dot }} />
          <div className="min-w-0">
            <div className="font-mono text-[13px] font-bold text-[var(--cs-text)] truncate">{incident.title}</div>
            <div className="font-mono text-[9px] text-[var(--cs-text-muted)] mt-0.5">{incident.reason}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <SevBadge sev={incident.severity} />
          <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{incident.alerts.length} alerts</span>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="p-1 text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onClose} className="font-mono text-[10px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] px-2 py-1 border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] transition-colors">
            ✕
          </button>
        </div>
      </div>

      {/* Panel body — scrollable */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Meta bar */}
        <div className="grid grid-cols-4 gap-px bg-[var(--cs-surface)] border border-[var(--cs-surface)]">
          {[
            { label: "Account",    value: incident.accountId,                      Icon: User2    },
            { label: "Region",     value: incident.region,                          Icon: MapPin   },
            { label: "Duration",   value: durationStr(incident.firstSeen, incident.lastSeen), Icon: Clock },
            { label: "Status",     value: incident.status.toUpperCase(),             Icon: Zap      },
          ].map((m) => (
            <div key={m.label} className="bg-[var(--cs-bg)] px-4 py-3 flex items-center gap-2">
              <m.Icon className="w-3 h-3 text-[var(--cs-text-muted)] flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-mono text-[8px] text-[var(--cs-border2)] tracking-[0.08em]">{m.label.toUpperCase()}</div>
                <div className="font-mono text-[11px] text-[var(--cs-text-dim)] truncate">{m.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Kill chain progress */}
        {data && (
          <div>
            <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em] mb-1.5">KILL CHAIN PROGRESSION</div>
            <KillChainBar activeTactics={activeTactics} />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 text-[var(--cs-text-muted)] animate-spin" />
            <span className="font-mono text-[10px] text-[var(--cs-text-muted)] tracking-[0.1em]">GENERATING ANALYST REPORT…</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex items-center gap-3 p-4 bg-[#ff1a1a10] border border-[#ff1a1a30]">
            <AlertTriangle className="w-4 h-4 text-[#f14c4c]" />
            <span className="font-mono text-[11px] text-[#f14c4c]">{error}</span>
            <button onClick={() => void load()} className="ml-auto font-mono text-[10px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] underline">Retry</button>
          </div>
        )}

        {data && !loading && (
          <>
            {/* AI Narrative */}
            {data.narrative && <NarrativeCard narrative={data.narrative} />}

            {/* Vertical kill-chain timeline */}
            <div>
              <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em] mb-3">EVENT TIMELINE</div>
              <div className="space-y-0">
                {data.stages.map((stage, stageIdx) => {
                  const stageColor = phaseColor(stage.tactic);
                  const stageStyle = SEV_STYLE[stage.maxSeverity] ?? SEV_STYLE.LOW!;
                  return (
                    <div key={stage.tactic} className="relative">
                      {/* Stage header */}
                      <div
                        className="flex items-center gap-3 px-4 py-2 border-l-2 ml-[72px]"
                        style={{ borderColor: stageColor, backgroundColor: `${stageColor}08` }}
                      >
                        <span className="font-mono text-[8px] font-bold tracking-[0.15em]" style={{ color: stageColor }}>
                          PHASE {PHASE_ORDER.indexOf(stage.tactic) + 1} — {stage.tactic.toUpperCase()}
                        </span>
                        <span className="font-mono text-[8px] text-[var(--cs-border2)]">{stage.alerts.length} events</span>
                        <SevBadge sev={stage.maxSeverity} />
                      </div>

                      {/* Events in this stage */}
                      {stage.alerts.map((alert, alertIdx) => {
                        const isLast = stageIdx === data.stages.length - 1 && alertIdx === stage.alerts.length - 1;
                        const alertStyle = SEV_STYLE[alert.severity] ?? SEV_STYLE.LOW!;
                        return (
                          <div key={alert.id} className="flex items-start gap-0 relative">
                            {/* Time column */}
                            <div className="w-[72px] flex-shrink-0 flex flex-col items-end pr-3 pt-3">
                              <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{fmtDate(alert.createdAt)}</span>
                              <span className="font-mono text-[8px] text-[var(--cs-border2)]">{fmtTime(alert.createdAt)}</span>
                            </div>

                            {/* Line + dot */}
                            <div className="flex flex-col items-center w-[18px] flex-shrink-0">
                              <div className="w-px flex-1 bg-[var(--cs-border)]" style={{ minHeight: "8px" }} />
                              <div
                                className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 z-10"
                                style={{ backgroundColor: "var(--cs-bg)", borderColor: alertStyle.dot }}
                              />
                              {!isLast && <div className="w-px flex-1 bg-[var(--cs-border)]" style={{ minHeight: "8px" }} />}
                            </div>

                            {/* Event card */}
                            <div className="flex-1 ml-3 mb-2 mt-2">
                              <Link href={`/alerts/${alert.id}`}>
                                <div className="group border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] transition-all p-3 cursor-pointer">
                                  <div className="flex items-start justify-between gap-2 mb-1.5">
                                    <div className="font-mono text-[11px] font-medium text-[var(--cs-text-dim)] group-hover:text-[var(--cs-text)] transition-colors leading-tight flex-1">
                                      {alert.title}
                                    </div>
                                    <SevBadge sev={alert.severity} />
                                  </div>
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)]" style={{ color: stageColor }}>
                                      {alert.mitreAttackTechniqueId}
                                    </span>
                                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{alert.mitreAttackTechnique}</span>
                                    <span className="w-px h-2.5 bg-[var(--cs-border)]" />
                                    <Server className="w-2.5 h-2.5 text-[var(--cs-text-muted)]" />
                                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)] truncate max-w-[160px]">{alert.affectedResource}</span>
                                    {alert.verdict && (
                                      <>
                                        <span className="w-px h-2.5 bg-[var(--cs-border)]" />
                                        <span
                                          className="font-mono text-[8px] px-1 py-[1px]"
                                          style={{
                                            color: alert.verdict === "TRUE_POSITIVE" ? "#f14c4c" : alert.verdict === "FALSE_POSITIVE" ? "#1db954" : "var(--cs-text-dim)",
                                          }}
                                        >
                                          {alert.verdict?.replace(/_/g, " ")}
                                        </span>
                                      </>
                                    )}
                                    <ChevronRight className="w-2.5 h-2.5 text-[var(--cs-text-muted)] group-hover:text-[#ff9900] transition-colors ml-auto" />
                                  </div>
                                </div>
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Affected resources */}
            {data.resources.length > 0 && (
              <div className="border border-[var(--cs-border)] overflow-hidden">
                <div className="px-4 py-2.5 bg-[var(--cs-surface)] border-b border-[var(--cs-border)] flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
                  <span className="font-mono text-[10px] font-bold text-[var(--cs-text-dim)] tracking-wider">
                    AFFECTED RESOURCES ({data.resources.length})
                  </span>
                </div>
                <div className="divide-y divide-[var(--cs-surface)]">
                  {data.resources.map((r) => {
                    const rs = SEV_STYLE[r.topSeverity] ?? SEV_STYLE.LOW!;
                    return (
                      <div key={r.resource} className="flex items-center gap-3 px-4 py-2.5 bg-[var(--cs-bg)] hover:bg-[var(--cs-surface)] transition-colors">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: rs.dot }} />
                        <span className="font-mono text-[11px] text-[var(--cs-text-dim)] flex-1 truncate">{r.resource}</span>
                        <span className="font-mono text-[10px] text-[var(--cs-text-muted)]">{r.alerts} alerts</span>
                        <SevBadge sev={r.topSeverity} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Incidents() {
  const { data: rawAlerts, isLoading } = useListAlerts();
  const [sevFilter, setSevFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const incidents = useMemo(() => {
    if (!rawAlerts) return [];
    return correlateAlerts(rawAlerts as unknown as Alert[]);
  }, [rawAlerts]);

  const filtered = sevFilter === "all" ? incidents : incidents.filter((i) => i.severity === sevFilter);
  const selected = incidents.find((i) => i.id === selectedId) ?? null;

  const critCount = incidents.filter((i) => i.severity === "CRITICAL").length;
  const totalAlertsInIncidents = incidents.reduce((s, i) => s + i.alertIds.length, 0);

  return (
    <div className="flex h-full gap-0 -m-6 min-h-0">
      {/* ── Left panel: incident list ── */}
      <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-[var(--cs-border)] h-full overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--cs-border)] bg-[var(--cs-surface)] flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Siren className="w-3.5 h-3.5 text-[#ff9900]" />
              <span className="font-mono text-[12px] font-bold text-[var(--cs-text)] tracking-wide">INCIDENTS</span>
            </div>
            {critCount > 0 && (
              <span className="font-mono text-[9px] text-[#f14c4c] font-bold animate-pulse">
                {critCount} CRIT
              </span>
            )}
          </div>

          {/* Mini stats */}
          <div className="grid grid-cols-3 gap-1 mt-2.5">
            {[
              { label: "Total", value: incidents.length, color: "var(--cs-orange)" },
              { label: "Critical", value: critCount, color: "#f14c4c" },
              { label: "Alerts", value: totalAlertsInIncidents, color: "#f59e0b" },
            ].map((s) => (
              <div key={s.label} className="bg-[var(--cs-bg)] border border-[var(--cs-border)] px-2 py-1.5 text-center">
                <div className="font-mono text-[14px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
                <div className="font-mono text-[7px] text-[var(--cs-text-muted)] tracking-wider mt-0.5">{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>

          {/* Severity filter */}
          <div className="flex gap-1 mt-2.5">
            {["all", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((f) => {
              const s = SEV_STYLE[f];
              const isActive = sevFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setSevFilter(f)}
                  className="flex-1 py-1 font-mono text-[8px] tracking-wider transition-all"
                  style={{
                    backgroundColor: isActive ? (s ? s.bg : "#ff990015") : "transparent",
                    color: isActive ? (s ? s.text : "var(--cs-orange)") : "var(--cs-text-muted)",
                    border: `1px solid ${isActive ? (s ? s.border : "#ff990040") : "var(--cs-border)"}`,
                  }}
                >
                  {f === "all" ? "ALL" : f.slice(0, 4)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Incident list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-4 h-4 text-[var(--cs-text-muted)] animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 px-4">
              <Shield className="w-5 h-5 text-[#1db954]" />
              <span className="font-mono text-[10px] text-[var(--cs-text-muted)] text-center">No incidents detected</span>
            </div>
          ) : (
            <div className="divide-y divide-[var(--cs-surface)]">
              {filtered.map((incident) => {
                const s = SEV_STYLE[incident.severity] ?? SEV_STYLE.LOW!;
                const isSelected = selectedId === incident.id;
                return (
                  <button
                    key={incident.id}
                    onClick={() => setSelectedId(isSelected ? null : incident.id)}
                    className="w-full text-left px-4 py-3 transition-all relative"
                    style={{
                      backgroundColor: isSelected ? "var(--cs-surface)" : "transparent",
                      borderLeft: isSelected ? `2px solid ${s.dot}` : "2px solid transparent",
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: s.dot }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[11px] font-medium text-[var(--cs-text-dim)] leading-snug line-clamp-2 mb-1.5">
                          {incident.title}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <SevBadge sev={incident.severity} />
                          <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{incident.alertIds.length} alerts</span>
                          <span className="font-mono text-[8px] text-[var(--cs-border2)]">{timeAgo(incident.lastSeen)}</span>
                        </div>
                        <div className="font-mono text-[8px] text-[var(--cs-border2)] mt-1 truncate">{incident.accountId}</div>
                      </div>
                      <ChevronRight
                        className="w-3 h-3 flex-shrink-0 mt-1 transition-colors"
                        style={{ color: isSelected ? s.dot : "var(--cs-border)" }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: timeline detail ── */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {selected ? (
          <IncidentTimeline
            key={selected.id}
            incident={selected}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div className="w-12 h-12 border border-[var(--cs-border)] flex items-center justify-center">
              <Crosshair className="w-5 h-5 text-[var(--cs-text-muted)]" />
            </div>
            <div>
              <div className="font-mono text-[13px] font-bold text-[var(--cs-text-muted)] mb-1.5">Select an incident</div>
              <p className="font-mono text-[10px] text-[var(--cs-border2)] leading-relaxed max-w-xs">
                Choose an incident from the list to view the full kill-chain timeline, AI analyst report, and affected resources.
              </p>
            </div>
            {incidents.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <TrendingUp className="w-3 h-3 text-[var(--cs-text-muted)]" />
                <span className="font-mono text-[10px] text-[var(--cs-text-muted)]">
                  {incidents.length} incidents · {totalAlertsInIncidents} correlated alerts
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

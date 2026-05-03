import { useGetAlertStats } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useLocation, Link } from "wouter";
import { Activity, Clock, AlertTriangle, Target, TrendingUp, Shield, Crosshair, Search } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAlertStatsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useGlobalFilters, type Timeframe } from "@/lib/global-filters-context";

function timeframeToSince(tf: Timeframe): string {
  const days = ({ "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as Record<Timeframe, number>)[tf];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

type ExtendedStats = {
  total: number;
  bySeverity: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  byStatus: { pending: number; generated: number; applied: number; failed: number };
  byResourceType: { IAM_ROLE: number; EC2_INSTANCE: number; S3_BUCKET: number; OTHER: number };
  recentActivity: Array<{
    id: number;
    title: string;
    severity: string;
    mitreAttackTactic: string;
    remediationStatus: string;
    affectedResource: string;
    createdAt: string;
  }>;
  mttrMinutes?: number;
  mttdMinutes?: number;
  staleFindings?: number;
  threatVelocity?: Array<{ date: string; count: number }>;
  topResources?: Array<{ resource: string; count: number; topSeverity: string }>;
};

const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const SEV_COLOR: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  CRITICAL: { text: "#f14c4c", bg: "#ff1a1a12", border: "#ff1a1a40", dot: "#f14c4c" },
  HIGH:     { text: "#ff8533", bg: "#ff6b0012", border: "#ff6b0040", dot: "#ff8533" },
  MEDIUM:   { text: "#fbbf24", bg: "#f59e0b12", border: "#f59e0b40", dot: "#fbbf24" },
  LOW:      { text: "#60a5fa", bg: "#3b82f612", border: "#3b82f640", dot: "#60a5fa" },
};
const STATUS_COLOR: Record<string, string> = {
  applied: "#1db954", generated: "#60a5fa", pending: "#f59e0b", failed: "#f14c4c",
};
const MITRE_TACTICS = [
  "Initial Access", "Execution", "Persistence", "Privilege Escalation",
  "Defense Evasion", "Credential Access", "Discovery", "Lateral Movement",
  "Collection", "Command and Control", "Exfiltration", "Impact",
];

function formatMins(mins: number) {
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

function computePosture(stats: ExtendedStats | undefined): number {
  if (!stats) return 100;
  let score = 100;
  score -= (stats.bySeverity?.CRITICAL || 0) * 18;
  score -= (stats.bySeverity?.HIGH || 0) * 9;
  score -= (stats.bySeverity?.MEDIUM || 0) * 4;
  score -= (stats.staleFindings || 0) * 5;
  score += Math.min((stats.byStatus?.applied || 0) * 4, 20);
  return Math.max(5, Math.min(100, Math.round(score)));
}

function postureLabel(s: number) {
  if (s >= 85) return "SECURE";
  if (s >= 65) return "MODERATE";
  if (s >= 40) return "ELEVATED";
  return "CRITICAL";
}
function postureColor(s: number) {
  if (s >= 85) return "#ff9900";
  if (s >= 65) return "#f59e0b";
  if (s >= 40) return "#f97316";
  return "#ef4444";
}

function PostureGauge({ score }: { score: number }) {
  const r = 48;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = postureColor(score);
  const label = postureLabel(score);
  return (
    <div className="relative" style={{ width: 128, height: 128 }}>
      <svg width="128" height="128" viewBox="0 0 128 128" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--cs-border2)" strokeWidth="9" />
        <circle
          cx="64" cy="64" r={r} fill="none"
          stroke={color} strokeWidth="9"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.2s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ color, fontSize: 28, fontWeight: 700, fontFamily: "monospace", lineHeight: 1 }}>{score}</span>
        <span style={{ color: "var(--cs-text-dim)", fontSize: 8, fontFamily: "monospace", letterSpacing: "0.1em", marginTop: 2 }}>{label}</span>
      </div>
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[3px] ${className}`}
      style={{ background: "var(--cs-surface)", border: "1px solid var(--cs-border2)" }}
    >
      {children}
    </div>
  );
}

function PanelHeader({ title, icon, extra }: { title: string; icon?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid var(--cs-border2)" }}>
      <div className="flex items-center gap-2">
        {icon && <span style={{ color: "var(--cs-text-muted)" }}>{icon}</span>}
        <span className="font-mono text-[10px] font-bold tracking-[0.15em]" style={{ color: "var(--cs-text-dim)" }}>{title}</span>
      </div>
      {extra}
    </div>
  );
}

export function Dashboard() {
  const [, navigate] = useLocation();
  const { filters } = useGlobalFilters();
  const statsParams = useMemo(() => ({
    ...(filters.accountId !== "all" ? { accountId: filters.accountId } : {}),
    since: timeframeToSince(filters.timeframe),
  }), [filters.accountId, filters.timeframe]);
  const { data: rawStats, isLoading, isError } = useGetAlertStats(statsParams);
  const stats = rawStats as ExtendedStats | undefined;
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // SSE live feed — refetch stats + toast on new webhook alerts
  const handleSseEvent = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as {
        alertId?: number;
        title?: string;
        severity?: string;
        verdict?: string;
      };
      if (event.type === "new-alert") {
        queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey(statsParams) });
        toast({
          title: "New GuardDuty Alert",
          description: data.title ?? "Finding received — AI triage starting…",
        });
      } else if (event.type === "triage-complete") {
        queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey(statsParams) });
      }
    } catch {}
  }, [queryClient, toast, statsParams]);

  useEffect(() => {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(`${basePath}/api/alerts/stream`);
    es.addEventListener("new-alert", handleSseEvent);
    es.addEventListener("triage-complete", handleSseEvent);
    return () => { es.close(); };
  }, [handleSseEvent]);

  const postureScore = computePosture(stats);
  const now = new Date();

  const tacticCounts: Record<string, number> = {};
  for (const t of MITRE_TACTICS) {
    tacticCounts[t] = stats?.recentActivity?.filter(a => a.mitreAttackTactic === t).length || 0;
  }

  const activeIncidents = [...(stats?.recentActivity || [])]
    .filter(a => a.remediationStatus === "pending" || a.remediationStatus === "generated")
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
    .slice(0, 6);

  const filteredActivity = stats?.recentActivity?.filter(a => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.severity.toLowerCase().includes(q) ||
      a.mitreAttackTactic?.toLowerCase().includes(q) ||
      a.remediationStatus.toLowerCase().includes(q) ||
      a.affectedResource?.toLowerCase().includes(q)
    );
  }) ?? [];

  const maxVelocity = Math.max(1, ...(stats?.threatVelocity?.map(d => d.count) ?? []));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="font-mono text-[11px] tracking-widest animate-pulse" style={{ color: "var(--cs-text-muted)" }}>
          LOADING THREAT INTELLIGENCE...
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="font-mono text-[11px]" style={{ color: "var(--cs-red)" }}>ERROR LOADING SECURITY DATA</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono font-bold text-[20px] tracking-tight" style={{ color: "var(--cs-text)" }}>
            SECURITY COMMAND CENTER
          </h1>
          <p className="font-mono text-[10px] tracking-[0.1em] mt-0.5" style={{ color: "var(--cs-text-muted)" }}>
            {format(now, "EEE dd MMM yyyy · HH:mm:ss")} UTC · GUARD AI v2.0
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(stats?.staleFindings ?? 0) > 0 && (
            <Link href="/alerts">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f59e0b12] border border-[#f59e0b40] rounded-[2px] cursor-pointer hover:bg-[#f59e0b18] transition-colors">
                <AlertTriangle className="w-3 h-3 text-[#fbbf24]" />
                <span className="font-mono text-[10px] text-[#fbbf24] font-bold">
                  {stats!.staleFindings} STALE &gt;24H
                </span>
              </div>
            </Link>
          )}
          {(stats?.bySeverity?.CRITICAL ?? 0) > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#ff1a1a12] border border-[#ff1a1a40] rounded-[2px] animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f14c4c]" />
              <span className="font-mono text-[10px] text-[#f14c4c] font-bold">
                {stats!.bySeverity.CRITICAL} CRITICAL ACTIVE
              </span>
            </div>
          )}
          <Link href="/analyze">
            <button className="px-3 py-1.5 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[10px] tracking-[0.12em] rounded-[2px] transition-colors">
              + ANALYZE
            </button>
          </Link>
        </div>
      </div>

      {/* ── Row 1: Threat Posture + Severity Grid ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "auto 1fr" }}>
        {/* Posture card */}
        <Panel className="flex flex-col items-center justify-center px-6 py-4 min-w-[200px]">
          <span className="font-mono text-[9px] tracking-[0.15em] mb-3" style={{ color: "var(--cs-text-muted)" }}>THREAT POSTURE</span>
          <PostureGauge score={postureScore} />
          <div className="mt-3 text-center">
            <div className="font-mono text-[9px] tracking-wider" style={{ color: "var(--cs-text-muted)" }}>OVERALL RISK SCORE</div>
            <div
              className="font-mono text-[10px] font-bold mt-1 tracking-wider"
              style={{ color: postureColor(postureScore) }}
            >
              {postureLabel(postureScore)} RISK
            </div>
          </div>
        </Panel>

        {/* Severity breakdown */}
        <div className="grid grid-cols-4 gap-3">
          {SEV_ORDER.map(sev => {
            const s = SEV_COLOR[sev];
            const count = stats?.bySeverity?.[sev as keyof typeof stats.bySeverity] ?? 0;
            return (
              <Panel key={sev} className="flex flex-col justify-between p-4">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="font-mono text-[9px] font-bold tracking-[0.15em]"
                    style={{ color: s.text }}
                  >{sev}</span>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: count > 0 ? s.dot : "var(--cs-border2)" }}
                  />
                </div>
                <div style={{ color: count > 0 ? s.text : "var(--cs-text-muted)" }} className="font-mono font-bold text-[42px] leading-none">
                  {count}
                </div>
                <div className="mt-3 h-[3px] rounded-full overflow-hidden" style={{ background: "var(--cs-border2)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: stats?.total ? `${(count / stats.total) * 100}%` : "0%",
                      backgroundColor: count > 0 ? s.dot : "var(--cs-border2)",
                    }}
                  />
                </div>
                <div className="font-mono text-[9px] mt-1.5" style={{ color: "var(--cs-text-muted)" }}>
                  {stats?.total ? Math.round((count / stats.total) * 100) : 0}% OF TOTAL
                </div>
              </Panel>
            );
          })}
        </div>
      </div>

      {/* ── Row 2: Incidents + MITRE + Metrics ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "5fr 4fr 3fr" }}>
        {/* Active Incidents */}
        <Panel>
          <PanelHeader
            title="ACTIVE INCIDENTS"
            icon={<AlertTriangle className="w-3 h-3" />}
            extra={
              <span className="font-mono text-[9px]" style={{ color: "var(--cs-text-muted)" }}>
                {activeIncidents.length} OPEN
              </span>
            }
          />
          <div className="divide-y" style={{ borderColor: "var(--cs-border2)" }}>
            {activeIncidents.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="font-mono text-[11px]" style={{ color: "var(--cs-text-muted)" }}>NO ACTIVE INCIDENTS</div>
                <div className="font-mono text-[10px] mt-1" style={{ color: "var(--cs-text-muted)" }}>All findings resolved</div>
              </div>
            ) : (
              activeIncidents.map(inc => {
                const s = SEV_COLOR[inc.severity] ?? SEV_COLOR.LOW;
                return (
                  <Link key={inc.id} href={`/alerts/${inc.id}`}>
                    <div className="flex items-start gap-3 px-4 py-2.5 transition-colors cursor-pointer"
                      style={{}}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--cs-surface2)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                    >
                      <span
                        className="mt-0.5 px-1.5 py-[1px] rounded-[2px] font-mono text-[8px] font-bold flex-shrink-0"
                        style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.text }}
                      >{inc.severity.charAt(0)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[11px] truncate" style={{ color: "var(--cs-text)" }}>{inc.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[9px]" style={{ color: "var(--cs-text-muted)" }}>{inc.mitreAttackTactic}</span>
                          <span style={{ color: "var(--cs-border2)" }}>·</span>
                          <span
                            className="font-mono text-[9px]"
                            style={{ color: STATUS_COLOR[inc.remediationStatus] }}
                          >{inc.remediationStatus}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
          {(stats?.recentActivity?.length ?? 0) > activeIncidents.length && (
            <div className="px-4 py-2" style={{ borderTop: "1px solid var(--cs-border2)" }}>
              <Link href="/alerts">
                <span className="font-mono text-[10px] transition-colors cursor-pointer" style={{ color: "var(--cs-text-muted)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--cs-orange)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--cs-text-muted)"}
                >
                  VIEW ALL {stats?.total} ALERTS →
                </span>
              </Link>
            </div>
          )}
        </Panel>

        {/* MITRE ATT&CK Heatmap */}
        <Panel>
          <PanelHeader title="MITRE ATT&CK COVERAGE" icon={<Crosshair className="w-3 h-3" />} />
          <div className="p-3 grid grid-cols-3 gap-1.5">
            {MITRE_TACTICS.map(tactic => {
              const count = tacticCounts[tactic] || 0;
              const color = count === 0 ? null : count === 1 ? "#f59e0b" : "#f14c4c";
              const bg = count === 0 ? "var(--cs-surface)" : count === 1 ? "#f59e0b10" : "#ff1a1a10";
              const border = count === 0 ? "var(--cs-border2)" : count === 1 ? "#f59e0b40" : "#ff1a1a40";
              return (
                <div
                  key={tactic}
                  className="rounded-[2px] p-2 flex flex-col gap-1 transition-all"
                  style={{ backgroundColor: bg, border: `1px solid ${border}` }}
                >
                  <span
                    className="font-mono text-[8px] font-bold leading-tight"
                    style={{ color: color ?? "var(--cs-text-muted)" }}
                  >
                    {tactic.toUpperCase().replace(" ", "\n")}
                  </span>
                  <span
                    className="font-mono text-[16px] font-bold leading-none"
                    style={{ color: color ?? "var(--cs-text-muted)" }}
                  >{count}</span>
                </div>
              );
            })}
          </div>
          <div className="px-3 pb-3 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[1px]" style={{ background: "var(--cs-surface2)", border: "1px solid var(--cs-border2)" }} />
              <span className="font-mono text-[8px]" style={{ color: "var(--cs-text-muted)" }}>None</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[1px] bg-[#f59e0b20] border border-[#f59e0b40]" />
              <span className="font-mono text-[8px]" style={{ color: "var(--cs-text-muted)" }}>Active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[1px] bg-[#ff1a1a20] border border-[#ff1a1a40]" />
              <span className="font-mono text-[8px]" style={{ color: "var(--cs-text-muted)" }}>High Volume</span>
            </div>
          </div>
        </Panel>

        {/* SOC Metrics */}
        <Panel>
          <PanelHeader title="SOC METRICS" icon={<Activity className="w-3 h-3" />} />
          <div className="divide-y" style={{ borderColor: "var(--cs-border2)" }}>
            {[
              {
                label: "MTTD",
                sub: "Mean Time to Detect",
                icon: <Clock className="w-3 h-3" />,
                value: stats?.mttdMinutes != null ? formatMins(stats.mttdMinutes) : "—",
                color: "#60a5fa",
                good: (stats?.mttdMinutes ?? 999) < 60,
              },
              {
                label: "MTTR",
                sub: "Mean Time to Respond",
                icon: <TrendingUp className="w-3 h-3" />,
                value: stats?.mttrMinutes != null ? (stats.mttrMinutes === 0 ? "—" : formatMins(stats.mttrMinutes)) : "—",
                color: "#1db954",
                good: true,
              },
              {
                label: "OPEN",
                sub: "Active Findings",
                icon: <Shield className="w-3 h-3" />,
                value: String((stats?.byStatus?.pending ?? 0) + (stats?.byStatus?.generated ?? 0)),
                color: (stats?.byStatus?.pending ?? 0) + (stats?.byStatus?.generated ?? 0) > 0 ? "#f59e0b" : "#1db954",
                good: ((stats?.byStatus?.pending ?? 0) + (stats?.byStatus?.generated ?? 0)) === 0,
              },
              {
                label: "STALE",
                sub: "Pending > 24h",
                icon: <AlertTriangle className="w-3 h-3" />,
                value: String(stats?.staleFindings ?? 0),
                color: (stats?.staleFindings ?? 0) > 0 ? "#ff8533" : "#1db954",
                good: (stats?.staleFindings ?? 0) === 0,
              },
              {
                label: "7D VOL.",
                sub: "Findings This Week",
                icon: <Target className="w-3 h-3" />,
                value: String(stats?.threatVelocity?.reduce((s, d) => s + d.count, 0) ?? 0),
                color: "var(--cs-orange)",
                good: true,
              },
            ].map((m) => (
              <div key={m.label} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--cs-text-muted)" }}>{m.icon}</span>
                  <div>
                    <div className="font-mono text-[9px] font-bold tracking-wider" style={{ color: "var(--cs-text-dim)" }}>{m.label}</div>
                    <div className="font-mono text-[8px]" style={{ color: "var(--cs-text-muted)" }}>{m.sub}</div>
                  </div>
                </div>
                <div className="font-mono text-[22px] font-bold leading-none" style={{ color: m.color }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Row 3: Timeline + Asset Exposure ── */}
      <div className="grid grid-cols-[3fr_2fr] gap-4">
        {/* Threat Timeline */}
        <Panel>
          <PanelHeader
            title="7-DAY THREAT TIMELINE"
            icon={<TrendingUp className="w-3 h-3" />}
            extra={
              <span className="font-mono text-[9px]" style={{ color: "var(--cs-text-muted)" }}>
                {stats?.threatVelocity?.reduce((s, d) => s + d.count, 0) ?? 0} TOTAL
              </span>
            }
          />
          <div className="p-4">
            {stats?.threatVelocity?.length ? (
              <div className="flex items-end gap-2 h-24">
                {stats.threatVelocity.map((d) => {
                  const pct = maxVelocity > 0 ? (d.count / maxVelocity) * 100 : 0;
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                      <span className="font-mono text-[8px]" style={{ color: "var(--cs-text-muted)" }}>
                        {d.count > 0 ? d.count : ""}
                      </span>
                      <div className="w-full rounded-[2px] overflow-hidden" style={{ height: 60, background: "var(--cs-border2)" }}>
                        <div
                          className="w-full rounded-[2px] transition-all duration-700"
                          style={{
                            height: `${Math.max(pct, d.count > 0 ? 8 : 0)}%`,
                            backgroundColor: d.count === 0 ? "var(--cs-border2)" : d.count >= 3 ? "#f14c4c" : d.count >= 2 ? "#f59e0b" : "var(--cs-orange)",
                            marginTop: "auto",
                          }}
                        />
                      </div>
                      <span className="font-mono text-[8px]" style={{ color: "var(--cs-text-muted)" }}>
                        {format(new Date(d.date), "dd")}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center">
                <span className="font-mono text-[10px]" style={{ color: "var(--cs-text-muted)" }}>NO TIMELINE DATA</span>
              </div>
            )}
          </div>
        </Panel>

        {/* Asset Exposure */}
        <Panel>
          <PanelHeader title="ASSET EXPOSURE" icon={<Target className="w-3 h-3" />} />
          <div className="p-4 space-y-3">
            {/* By resource type */}
            {[
              { label: "IAM ROLES", key: "IAM_ROLE", color: "#f14c4c" },
              { label: "EC2 INSTANCES", key: "EC2_INSTANCE", color: "#f59e0b" },
              { label: "S3 BUCKETS", key: "S3_BUCKET", color: "#60a5fa" },
              { label: "OTHER", key: "OTHER", color: "var(--cs-text-muted)" },
            ].map(({ label, key, color }) => {
              const count = stats?.byResourceType?.[key as keyof typeof stats.byResourceType] ?? 0;
              const total = stats?.total ?? 1;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[9px]" style={{ color: "var(--cs-text-dim)" }}>{label}</span>
                    <span className="font-mono text-[9px]" style={{ color }}>{count}</span>
                  </div>
                  <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "var(--cs-border2)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Top targeted resources */}
            {(stats?.topResources?.length ?? 0) > 0 && (
              <div className="pt-2" style={{ borderTop: "1px solid var(--cs-border2)" }}>
                <div className="font-mono text-[9px] tracking-[0.1em] mb-2" style={{ color: "var(--cs-text-muted)" }}>TOP TARGETS</div>
                {stats!.topResources!.slice(0, 3).map((r) => {
                  const s = SEV_COLOR[r.topSeverity] ?? SEV_COLOR.LOW;
                  return (
                    <div key={r.resource} className="flex items-center justify-between py-1">
                      <span className="font-mono text-[9px] truncate max-w-[140px]" style={{ color: "var(--cs-text-dim)" }}>{r.resource}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="font-mono text-[8px]" style={{ color: s.text }}>{r.topSeverity.charAt(0)}</span>
                        <span className="font-mono text-[9px]" style={{ color: "var(--cs-text-muted)" }}>{r.count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Row 4: Recent Findings with NL Filter ── */}
      <Panel>
        <PanelHeader
          title="RECENT FINDINGS"
          icon={<Search className="w-3 h-3" />}
          extra={
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter: 'critical EC2' or 'credential access'"
                className="rounded-[2px] px-2 py-1 font-mono text-[10px] outline-none transition-colors w-[280px]"
                style={{
                  background: "var(--cs-bg)",
                  border: "1px solid var(--cs-border2)",
                  color: "var(--cs-text)",
                }}
                onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--cs-orange)"}
                onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--cs-border2)"}
              />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--cs-border2)" }}>
                {["SEV", "TITLE", "TACTIC", "RESOURCE", "STATUS", "AGE"].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-mono text-[9px] tracking-[0.12em] font-medium" style={{ color: "var(--cs-text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredActivity.slice(0, 10).map(a => {
                const s = SEV_COLOR[a.severity] ?? SEV_COLOR.LOW;
                const age = (() => {
                  const ms = Date.now() - new Date(a.createdAt).getTime();
                  const h = Math.floor(ms / 3600000);
                  if (h < 1) return `${Math.floor(ms / 60000)}m`;
                  if (h < 24) return `${h}h`;
                  return `${Math.floor(h / 24)}d`;
                })();
                return (
                  <tr
                    key={a.id}
                    className="transition-colors cursor-pointer"
                    style={{ borderBottom: "1px solid var(--cs-border2)" }}
                    onClick={() => navigate(`/alerts/${a.id}`)}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--cs-surface2)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                  >
                    <td className="px-4 py-2.5">
                      <span
                        className="px-1.5 py-[2px] rounded-[2px] font-mono text-[9px] font-bold"
                        style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.text }}
                      >{a.severity}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] max-w-[240px] truncate" style={{ color: "var(--cs-text)" }}>{a.title}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px]" style={{ color: "var(--cs-text-dim)" }}>{a.mitreAttackTactic || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] max-w-[160px] truncate" style={{ color: "var(--cs-text-muted)" }}>{a.affectedResource}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[10px]" style={{ color: STATUS_COLOR[a.remediationStatus] }}>
                        ● {a.remediationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px]" style={{ color: "var(--cs-text-muted)" }}>{age}</td>
                  </tr>
                );
              })}
              {filteredActivity.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-mono text-[11px]" style={{ color: "var(--cs-text-muted)" }}>
                    {search ? "NO MATCHES FOR YOUR FILTER" : "NO FINDINGS"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

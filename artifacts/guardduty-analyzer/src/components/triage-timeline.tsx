/**
 * TriageTimeline — dynamic AI investigation progress tracker
 *
 * Renders stages as they accumulate from the iterative triage agent.
 * Fixed stages (Contextualize, IOC Enrichment, Verdict) have dedicated icons.
 * Investigation loop stages show the tool name and agent reasoning.
 */
import {
  Loader2, CheckCircle, XCircle, Clock,
  ShieldCheck, ShieldX, ShieldAlert,
  Globe, Search, Gavel,
  Brain, Network, Database, UserSearch, Shield, Activity, GitBranch,
  RotateCcw,
} from "lucide-react";

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

interface Props {
  triageStatus: string;
  triageStages: TriageStage[];
  verdict?: string | null;
  verdictConfidence?: number | null;
  source?: string;
}

const VERDICT_CONFIG = {
  TRUE_POSITIVE: {
    color: "#ff4444",
    bg: "#ff1a1a12",
    border: "#ff1a1a40",
    icon: <ShieldX className="w-4 h-4" />,
    label: "TRUE POSITIVE",
  },
  FALSE_POSITIVE: {
    color: "#22c55e",
    bg: "#22c55e12",
    border: "#22c55e40",
    icon: <ShieldCheck className="w-4 h-4" />,
    label: "FALSE POSITIVE",
  },
  NEEDS_REVIEW: {
    color: "#f59e0b",
    bg: "#f59e0b12",
    border: "#f59e0b40",
    icon: <ShieldAlert className="w-4 h-4" />,
    label: "NEEDS REVIEW",
  },
};

const TOOL_ICONS: Record<string, React.ReactNode> = {
  behavioral_analysis:   <Brain className="w-3.5 h-3.5" />,
  cloudtrail_simulation: <Activity className="w-3.5 h-3.5" />,
  lateral_movement:      <GitBranch className="w-3.5 h-3.5" />,
  data_exfiltration:     <Database className="w-3.5 h-3.5" />,
  persistence_check:     <Shield className="w-3.5 h-3.5" />,
  network_analysis:      <Network className="w-3.5 h-3.5" />,
  identity_analysis:     <UserSearch className="w-3.5 h-3.5" />,
};

const FIXED_ICONS: Record<string, React.ReactNode> = {
  "Contextualize & Verify": <Search className="w-3.5 h-3.5" />,
  "IOC Enrichment":         <Globe className="w-3.5 h-3.5" />,
  "Verdict":                <Gavel className="w-3.5 h-3.5" />,
};

function stageIcon(stage: TriageStage): React.ReactNode {
  if (stage.kind === "loop" && stage.tool) return TOOL_ICONS[stage.tool] ?? <Search className="w-3.5 h-3.5" />;
  return FIXED_ICONS[stage.name] ?? <Search className="w-3.5 h-3.5" />;
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StageCard({ stage, isLast }: { stage: TriageStage; isLast: boolean }) {
  const { status } = stage;

  return (
    <div className={`relative flex gap-3 p-3.5 rounded-[3px] border transition-all ${
      status === "running"
        ? "bg-[#00d4aa08] border-[#00d4aa30]"
        : status === "complete"
          ? "bg-[#0d1017] border-[#1c2030]"
          : status === "error"
            ? "bg-[#ff1a1a08] border-[#ff1a1a20]"
            : "bg-[#090b0f] border-[#141824]"
    }`}>
      {/* Status circle + connector */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border ${
          status === "running"
            ? "bg-[#00d4aa20] border-[#00d4aa60] text-[#00d4aa]"
            : status === "complete"
              ? "bg-[#22c55e20] border-[#22c55e40] text-[#22c55e]"
              : status === "error"
                ? "bg-[#ff1a1a20] border-[#ff1a1a40] text-[#ff4444]"
                : "bg-[#111520] border-[#1c2030] text-[#374151]"
        }`}>
          {status === "running" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : status === "complete" ? (
            <CheckCircle className="w-3.5 h-3.5" />
          ) : status === "error" ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <span className="font-mono text-[10px] font-bold">{stage.stage}</span>
          )}
        </div>
        {!isLast && (
          <div className={`w-[1px] flex-1 min-h-[16px] ${
            status === "complete" ? "bg-[#22c55e40]" : "bg-[#1c2030]"
          }`} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`flex-shrink-0 ${
              status === "running" ? "text-[#00d4aa]"
              : status === "complete" ? "text-[#374151]"
              : status === "error" ? "text-[#ff4444]"
              : "text-[#2d3748]"
            }`}>{stageIcon(stage)}</span>
            <span className={`font-mono text-[11px] font-semibold tracking-wide truncate ${
              status === "running" ? "text-[#00d4aa]"
              : status === "complete" ? "text-[#9ca3af]"
              : status === "error" ? "text-[#ff4444]"
              : "text-[#2d3748]"
            }`}>{stage.name.toUpperCase()}</span>
            {stage.kind === "loop" && (
              <span className="flex-shrink-0 px-1 py-[1px] bg-[#00d4aa12] border border-[#00d4aa20] rounded-[2px] font-mono text-[7px] text-[#00d4aa] tracking-wider">AGENT</span>
            )}
          </div>
          {stage.durationMs != null && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Clock className="w-2.5 h-2.5 text-[#374151]" />
              <span className="font-mono text-[9px] text-[#374151]">{formatDuration(stage.durationMs)}</span>
            </div>
          )}
        </div>

        {stage.summary && (
          <p className={`text-[11px] leading-relaxed ${
            status === "running" ? "text-[#e8eaf0]"
            : status === "complete" ? "text-[#6b7280]"
            : "text-[#374151]"
          }`}>
            {stage.summary}
          </p>
        )}

        {/* IOC tags for IOC Enrichment stage */}
        {stage.name === "IOC Enrichment" && status === "complete" && (() => {
          const ips = stage.details.extractedIps as string[] | undefined;
          const indicators = stage.details.threatIndicators as string[] | undefined;
          const hasThreat = indicators?.[0] && !indicators[0].includes("No high-risk");
          if (!ips?.length && !hasThreat) return null;
          return (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ips?.slice(0, 3).map((ip) => (
                <span key={ip} className="px-1.5 py-[1px] bg-[#111520] border border-[#1c2030] rounded-[2px] font-mono text-[9px] text-[#6b7280]">
                  {ip}
                </span>
              ))}
              {hasThreat && (
                <span className="px-1.5 py-[1px] bg-[#ff1a1a12] border border-[#ff1a1a30] rounded-[2px] font-mono text-[9px] text-[#ff4444]">
                  ⚠ Threat indicator
                </span>
              )}
            </div>
          );
        })()}

        {/* Behavioral verdict badge */}
        {stage.tool === "behavioral_analysis" && status === "complete" && (() => {
          const bv = stage.details?.behavioralVerdict as string | undefined;
          if (!bv) return null;
          const cls = bv === "likely_malicious"
            ? "bg-[#ff1a1a12] border border-[#ff1a1a30] text-[#ff4444]"
            : bv === "suspicious"
              ? "bg-[#f59e0b12] border border-[#f59e0b30] text-[#fbbf24]"
              : "bg-[#22c55e12] border border-[#22c55e30] text-[#22c55e]";
          return (
            <span className={`mt-1.5 inline-block px-1.5 py-[1px] rounded-[2px] font-mono text-[9px] font-bold ${cls}`}>
              {bv.replace(/_/g, " ").toUpperCase()}
            </span>
          );
        })()}

        {/* Agent confidence contribution */}
        {stage.kind === "loop" && status === "complete" && (() => {
          const cc = stage.details?.confidenceContribution as number | undefined;
          if (!cc) return null;
          return (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="font-mono text-[8px] text-[#374151]">CONFIDENCE +{cc}%</span>
              <div className="flex-1 max-w-[80px] h-[2px] bg-[#1c2030] rounded-full overflow-hidden">
                <div className="h-full bg-[#00d4aa]" style={{ width: `${Math.min(cc, 100)}%` }} />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function PendingLoopIndicator() {
  return (
    <div className="flex gap-3 p-3 rounded-[3px] border border-dashed border-[#1c2030] bg-[#090b0f]">
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center border border-[#1c2030] bg-[#111520]">
          <RotateCcw className="w-3 h-3 text-[#374151]" />
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-mono text-[10px] text-[#2d3748]">AGENT DECIDING NEXT ACTION…</span>
          <span className="w-1 h-1 rounded-full bg-[#00d4aa] animate-pulse" />
        </div>
        <p className="text-[10px] text-[#2d3748]">The AI investigator is reviewing evidence and choosing the next investigation step</p>
      </div>
    </div>
  );
}

export function TriageTimeline({ triageStatus, triageStages, verdict, verdictConfidence, source }: Props) {
  const isIdle = triageStatus === "idle" || triageStatus === "pending";
  const isRunning = triageStatus === "running" || triageStatus.startsWith("stage_");
  const isComplete = triageStatus === "complete";
  const isError = triageStatus === "error";

  const verdictCfg = verdict ? VERDICT_CONFIG[verdict as keyof typeof VERDICT_CONFIG] : null;

  // Count loop iterations
  const loopStages = triageStages.filter((s) => s.kind === "loop");
  const hasRunningStage = triageStages.some((s) => s.status === "running");

  // Show pending loop indicator when the agent is deciding (all stages complete but not done yet)
  const showDeciding = isRunning && !hasRunningStage && !isComplete;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold tracking-[0.15em] text-[#6b7280]">AI TRIAGE INVESTIGATION</span>
          {source === "webhook" && (
            <span className="px-1.5 py-[1px] bg-[#00d4aa12] border border-[#00d4aa30] rounded-[2px] font-mono text-[8px] text-[#00d4aa]">LIVE INGEST</span>
          )}
          {loopStages.length > 0 && (
            <span className="px-1.5 py-[1px] bg-[#111520] border border-[#1c2030] rounded-[2px] font-mono text-[8px] text-[#374151]">
              {loopStages.length} DEEP-DIVE{loopStages.length !== 1 ? "S" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00d4aa] animate-pulse" />
              <span className="font-mono text-[9px] text-[#00d4aa]">INVESTIGATING</span>
            </>
          )}
          {isComplete && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
              <span className="font-mono text-[9px] text-[#22c55e]">COMPLETE</span>
            </>
          )}
          {isIdle && <span className="font-mono text-[9px] text-[#374151]">QUEUED</span>}
          {isError && <span className="font-mono text-[9px] text-[#ff4444]">ERROR</span>}
        </div>
      </div>

      {/* Idle placeholder */}
      {isIdle && triageStages.length === 0 && (
        <div className="p-6 flex flex-col items-center gap-2 bg-[#090b0f] border border-[#141824] rounded-[3px]">
          <RotateCcw className="w-5 h-5 text-[#2d3748]" />
          <span className="font-mono text-[10px] text-[#2d3748]">Triage queued — awaiting pipeline start</span>
        </div>
      )}

      {/* Dynamic stage list */}
      {triageStages.length > 0 && (
        <div className="space-y-1">
          {triageStages.map((stage, i) => (
            <StageCard key={`${stage.stage}-${stage.name}`} stage={stage} isLast={i === triageStages.length - 1 && !showDeciding} />
          ))}
          {showDeciding && <PendingLoopIndicator />}
        </div>
      )}

      {/* Verdict card */}
      {verdictCfg && (
        <div
          className="p-4 rounded-[3px] border"
          style={{ backgroundColor: verdictCfg.bg, borderColor: verdictCfg.border }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2" style={{ color: verdictCfg.color }}>
              {verdictCfg.icon}
              <span className="font-mono text-[12px] font-bold tracking-widest">{verdictCfg.label}</span>
            </div>
            {verdictConfidence != null && (
              <div className="text-right">
                <div className="font-mono text-[20px] font-bold leading-none" style={{ color: verdictCfg.color }}>
                  {verdictConfidence}%
                </div>
                <div className="font-mono text-[8px] text-[#374151]">CONFIDENCE</div>
              </div>
            )}
          </div>
          {verdictConfidence != null && (
            <div className="h-[3px] bg-[#1c2030] rounded-full overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${verdictConfidence}%`, backgroundColor: verdictCfg.color }}
              />
            </div>
          )}

          {/* Reasoning */}
          {(() => {
            const verdictStage = triageStages.find((s) => s.kind === "verdict" && s.status === "complete");
            const reasoning = verdictStage?.details?.reasoning as string | undefined;
            if (!reasoning) return null;
            return (
              <p className="text-[11px] leading-relaxed mb-3" style={{ color: verdictCfg.color, opacity: 0.8 }}>
                {reasoning}
              </p>
            );
          })()}

          {/* Recommended actions */}
          {(() => {
            const verdictStage = triageStages.find((s) => s.kind === "verdict" && s.status === "complete");
            const actions = verdictStage?.details?.recommendedActions as string[] | undefined;
            if (!actions?.length) return null;
            return (
              <div className="space-y-1">
                <div className="font-mono text-[9px] tracking-widest text-[#374151]">RECOMMENDED ACTIONS</div>
                {actions.slice(0, 5).map((action, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="font-mono text-[9px] mt-0.5 flex-shrink-0" style={{ color: verdictCfg.color }}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[11px] leading-relaxed" style={{ color: verdictCfg.color, opacity: 0.8 }}>{action}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

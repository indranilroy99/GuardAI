/**
 * False Positive Learning Engine
 *
 * Tab 1 — Pattern Library: patterns extracted from FP history
 * Tab 2 — Auto-Suspect: open alerts scored against the pattern library;
 *          team can approve (→ FALSE_POSITIVE) or dismiss in bulk
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "wouter";
import {
  BookOpen, Search, ChevronRight, ChevronDown, ChevronUp,
  RefreshCw, Loader2, AlertTriangle, CheckCircle, TrendingUp,
  Shield, Database, Filter, Zap, CheckSquare, Square,
  ThumbsUp, ThumbsDown, SlidersHorizontal, Clock, Info,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

type Artifact = {
  id: number;
  title: string;
  affectedResource: string;
  accountId: string;
  region: string;
  resourceType: string;
  markedAt: string;
};

type Pattern = {
  key: string;
  type: string;
  mitreAttackTechniqueId: string;
  mitreAttackTechnique: string;
  mitreAttackTactic: string;
  frequency: number;
  accounts: string[];
  resourceTypes: string[];
  regions: string[];
  confidence: number;
  artifacts: Artifact[];
};

type Summary = {
  totalFpAlerts: number;
  totalTpAlerts: number;
  uniquePatterns: number;
  topPattern: Pattern | null;
};

type SuspectedAlert = {
  id: number;
  title: string;
  severity: string;
  type: string;
  affectedResource: string;
  accountId: string;
  region: string;
  resourceType: string;
  createdAt: string;
  score: number;
  confidence: number;
  matchReasons: string[];
  topPattern: { type: string; technique: string; tactic: string; techniqueId: string };
  evidence: Artifact[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function confidenceColor(c: number): string {
  if (c >= 90) return "#1db954";
  if (c >= 70) return "var(--cs-orange)";
  if (c >= 50) return "#f59e0b";
  return "#f97316";
}

function confidenceLabel(c: number): string {
  if (c >= 90) return "HIGH";
  if (c >= 70) return "MEDIUM";
  if (c >= 50) return "LOW";
  return "UNCERTAIN";
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#f14c4c",
  HIGH: "#ff8533",
  MEDIUM: "#fbbf24",
  LOW: "#60a5fa",
};

// ─── Pattern card ─────────────────────────────────────────────────────────────

function PatternCard({ pattern }: { pattern: Pattern }) {
  const [expanded, setExpanded] = useState(false);
  const cc = confidenceColor(pattern.confidence);

  return (
    <div className="border border-[var(--cs-border)] bg-[var(--cs-bg)] rounded-[3px] overflow-hidden hover:border-[var(--cs-text-muted)] transition-colors">
      <button
        className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-[var(--cs-surface)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
          <div className="w-10 h-10 rounded-full flex items-center justify-center border-2" style={{ borderColor: cc, backgroundColor: `${cc}10` }}>
            <span className="font-mono text-[11px] font-bold" style={{ color: cc }}>{pattern.confidence}%</span>
          </div>
          <span className="font-mono text-[7px] tracking-wider" style={{ color: cc }}>{confidenceLabel(pattern.confidence)}</span>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="font-mono text-[12px] font-bold text-[var(--cs-text)] leading-tight break-all">{pattern.type}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[8px] px-1.5 py-[2px] border rounded-[2px]" style={{ color: cc, borderColor: `${cc}40`, backgroundColor: `${cc}10` }}>
              {pattern.mitreAttackTechniqueId}
            </span>
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{pattern.mitreAttackTechnique}</span>
            <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{pattern.mitreAttackTactic}</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-mono text-[9px] text-[var(--cs-text-dim)]"><span className="font-bold text-[var(--cs-text)]">{pattern.frequency}</span> FP verdicts</span>
            {pattern.accounts.length > 0 && (
              <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{pattern.accounts.length} account{pattern.accounts.length !== 1 ? "s" : ""}{pattern.accounts.length <= 3 && `: ${pattern.accounts.join(", ")}`}</span>
            )}
            {pattern.resourceTypes.length > 0 && (
              <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{pattern.resourceTypes.slice(0, 2).join(", ")}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className="font-mono text-[10px] text-[var(--cs-text-muted)]">{pattern.artifacts.length} artifact{pattern.artifacts.length !== 1 ? "s" : ""}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--cs-border)] px-5 py-3 space-y-1.5 bg-[var(--cs-bg)]">
          <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.12em] mb-2">HISTORICAL ARTIFACTS</div>
          {pattern.artifacts.map((a) => (
            <Link key={a.id} href={`/alerts/${a.id}`}>
              <div className="group flex items-center gap-3 px-3 py-2.5 bg-[var(--cs-bg)] border border-[var(--cs-border)] hover:border-[#1db95430] rounded-[2px] cursor-pointer transition-all">
                <div className="w-1.5 h-1.5 rounded-full bg-[#1db954] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-[var(--cs-text-dim)] group-hover:text-[var(--cs-text)] transition-colors truncate">{a.title}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)] truncate max-w-[200px]">{a.affectedResource}</span>
                    <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{a.accountId}</span>
                    <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{timeAgo(a.markedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-[8px] px-1.5 py-[2px] bg-[#1db95415] border border-[#1db95430] text-[#1db954] rounded-[2px]">FALSE POSITIVE</span>
                  <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">#{a.id}</span>
                  <ChevronRight className="w-3 h-3 text-[var(--cs-text-muted)] group-hover:text-[#1db954] transition-colors" />
                </div>
              </div>
            </Link>
          ))}
          <div className="pt-2 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[9px] text-[var(--cs-border2)] tracking-[0.1em]">MATCH CRITERIA</span>
            {[`type = "${pattern.type}"`, `technique = ${pattern.mitreAttackTechniqueId}`, ...(pattern.accounts.length === 1 ? [`account = ${pattern.accounts[0]}`] : []), ...(pattern.resourceTypes.length === 1 ? [`resourceType = ${pattern.resourceTypes[0]}`] : [])].map((c) => (
              <span key={c} className="font-mono text-[8px] px-1.5 py-[2px] bg-[var(--cs-border)] border border-[var(--cs-text-muted)] text-[var(--cs-text-dim)] rounded-[2px]">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Suspect row ──────────────────────────────────────────────────────────────

function SuspectRow({
  suspect,
  selected,
  onToggle,
  onSingleVerdict,
  dismissed,
}: {
  suspect: SuspectedAlert;
  selected: boolean;
  onToggle: () => void;
  onSingleVerdict: (id: number, verdict: "FALSE_POSITIVE" | "TRUE_POSITIVE") => void;
  dismissed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (dismissed) return null;

  const sevColor = SEV_COLOR[suspect.severity] ?? "var(--cs-text-dim)";
  const cc = confidenceColor(suspect.confidence);

  return (
    <div className={`border rounded-[3px] overflow-hidden transition-colors ${selected ? "border-[#ff990040] bg-[#ff990005]" : "border-[var(--cs-border)] bg-[var(--cs-bg)] hover:border-[var(--cs-text-muted)]"}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Checkbox */}
        <button onClick={onToggle} className="mt-0.5 flex-shrink-0 text-[var(--cs-text-muted)] hover:text-[#ff9900] transition-colors">
          {selected ? <CheckSquare className="w-4 h-4 text-[#ff9900]" /> : <Square className="w-4 h-4" />}
        </button>

        {/* Score ring */}
        <div className="flex-shrink-0 flex flex-col items-center gap-0.5 mt-0.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center border-2" style={{ borderColor: cc, backgroundColor: `${cc}10` }}>
            <span className="font-mono text-[10px] font-bold" style={{ color: cc }}>{suspect.score}</span>
          </div>
          <span className="font-mono text-[7px]" style={{ color: cc }}>{confidenceLabel(suspect.confidence)}</span>
        </div>

        {/* Alert info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[9px] font-bold px-1.5 py-[1px] rounded-[2px]" style={{ color: sevColor, backgroundColor: `${sevColor}15`, border: `1px solid ${sevColor}30` }}>
              {suspect.severity}
            </span>
            <span className="font-mono text-[11px] font-semibold text-[var(--cs-text)] truncate max-w-[400px]">{suspect.title}</span>
            <span className="font-mono text-[8px] text-[var(--cs-text-muted)] ml-auto flex-shrink-0">#{suspect.id}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{suspect.affectedResource}</span>
            <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{suspect.accountId}</span>
            <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{suspect.region}</span>
            <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{timeAgo(suspect.createdAt)}</span>
          </div>
          {/* Match reasons chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {suspect.matchReasons.map((r) => (
              <span key={r} className="font-mono text-[8px] px-1.5 py-[2px] bg-[#f59e0b10] border border-[#f59e0b25] text-[#f59e0b] rounded-[2px]">{r}</span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="font-mono text-[9px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors px-2 py-1 border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[2px]"
          >
            {expanded ? "Hide" : "Evidence"}
          </button>
          <button
            onClick={() => onSingleVerdict(suspect.id, "FALSE_POSITIVE")}
            className="flex items-center gap-1 font-mono text-[9px] px-2 py-1 border border-[#1db95440] bg-[#1db95410] text-[#1db954] hover:bg-[#1db95420] rounded-[2px] transition-colors"
            title="Confirm as False Positive"
          >
            <ThumbsUp className="w-3 h-3" /> FP
          </button>
          <button
            onClick={() => onSingleVerdict(suspect.id, "TRUE_POSITIVE")}
            className="flex items-center gap-1 font-mono text-[9px] px-2 py-1 border border-[#f14c4c40] bg-[#f14c4c10] text-[#f14c4c] hover:bg-[#f14c4c20] rounded-[2px] transition-colors"
            title="Override — this is a True Positive"
          >
            <ThumbsDown className="w-3 h-3" /> TP
          </button>
        </div>
      </div>

      {/* Evidence panel */}
      {expanded && (
        <div className="border-t border-[var(--cs-border)] px-4 py-3 space-y-1.5 bg-[var(--cs-bg)]">
          <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.12em] mb-1.5">EVIDENCE — alerts that were marked as false positive with the same pattern</div>
          {suspect.evidence.map((a) => (
            <Link key={a.id} href={`/alerts/${a.id}`}>
              <div className="group flex items-center gap-3 px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] hover:border-[#1db95430] rounded-[2px] cursor-pointer transition-all">
                <div className="w-1.5 h-1.5 rounded-full bg-[#1db954] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-[var(--cs-text-dim)] group-hover:text-[var(--cs-text)] truncate">{a.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)] truncate max-w-[200px]">{a.affectedResource}</span>
                    <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{a.accountId}</span>
                    <span className="font-mono text-[8px] text-[var(--cs-border2)]">·</span>
                    <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{timeAgo(a.markedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-[8px] px-1.5 py-[2px] bg-[#1db95415] border border-[#1db95430] text-[#1db954] rounded-[2px]">FP CONFIRMED</span>
                  <ChevronRight className="w-3 h-3 text-[var(--cs-text-muted)] group-hover:text-[#1db954] transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Auto-Suspect Tab ─────────────────────────────────────────────────────────

function AutoSuspectTab() {
  const [threshold, setThreshold] = useState(80);
  const [suspects, setSuspects] = useState<SuspectedAlert[]>([]);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [fpHistorySize, setFpHistorySize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<{ count: number; verdict: string } | null>(null);

  const load = useCallback(async (t: number) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setDismissed(new Set());
    setLastResult(null);
    try {
      const r = await fetch(`${BASE_URL}/api/fp-engine/auto-suspect?threshold=${t}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load suspects");
      const d = await r.json() as { suspects: SuspectedAlert[]; totalCandidates: number; fpHistorySize: number };
      setSuspects(d.suspects);
      setTotalCandidates(d.totalCandidates);
      setFpHistorySize(d.fpHistorySize);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(threshold); }, []);

  const visible = suspects.filter((s) => !dismissed.has(s.id));
  const allSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visible.map((s) => s.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applyBulkVerdict(verdict: "FALSE_POSITIVE" | "TRUE_POSITIVE") {
    const ids = [...selected];
    if (ids.length === 0) return;
    setApplying(true);
    try {
      const r = await fetch(`${BASE_URL}/api/fp-engine/bulk-verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ alertIds: ids, verdict }),
      });
      if (!r.ok) throw new Error("Bulk verdict failed");
      const d = await r.json() as { updated: number };
      setLastResult({ count: d.updated, verdict });
      setDismissed((prev) => new Set([...prev, ...ids]));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply verdict");
    } finally {
      setApplying(false);
    }
  }

  async function applySingleVerdict(id: number, verdict: "FALSE_POSITIVE" | "TRUE_POSITIVE") {
    try {
      await fetch(`${BASE_URL}/api/fp-engine/bulk-verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ alertIds: [id], verdict }),
      });
      setDismissed((prev) => new Set([...prev, id]));
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch { /* silent — UI removes row immediately */ }
  }

  const timeSavedMin = Math.round(visible.length * 4.5);

  return (
    <div className="space-y-4">
      {/* How it works */}
      <div className="flex items-start gap-3 px-4 py-3 bg-[#ff990008] border border-[#ff990020] rounded-[3px]">
        <Info className="w-3.5 h-3.5 text-[#ff9900] flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-[var(--cs-text-muted)] leading-[1.7]">
          The engine scores every <strong className="text-[var(--cs-text-dim)]">unverdicited</strong> alert against your FP pattern library.
          Alerts above the threshold are shown here for bulk approval. Approve → marks as <strong className="text-[#1db954]">FALSE_POSITIVE</strong>.
          Override → marks as <strong className="text-[#f14c4c]">TRUE_POSITIVE</strong> and removes from future auto-suggestions.
          Adjust the threshold to tune sensitivity.
        </p>
      </div>

      {/* Threshold + stats row */}
      <div className="flex items-center gap-6 px-5 py-4 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[3px]">
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
              <span className="font-mono text-[10px] text-[var(--cs-text-dim)]">SCORE THRESHOLD</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[18px] font-bold" style={{ color: confidenceColor(threshold) }}>{threshold}</span>
              <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">/ 110</span>
            </div>
          </div>
          <input
            type="range" min={40} max={110} step={5} value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value))}
            className="w-full accent-[#ff9900] cursor-pointer"
          />
          <div className="flex items-center justify-between font-mono text-[8px] text-[var(--cs-border2)]">
            <span>40 — sensitive (type match)</span>
            <span>65 — type + technique</span>
            <span>80 — recommended</span>
            <span>110 — exact resource</span>
          </div>
        </div>

        <button
          onClick={() => void load(threshold)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] border border-[#ff990040] bg-[#ff990010] text-[#ff9900] hover:bg-[#ff990020] rounded-[2px] transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          Run scan
        </button>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-4 gap-px bg-[var(--cs-surface)] border border-[var(--cs-surface)] rounded-[3px] overflow-hidden">
          {[
            { label: "Suspected FP", value: visible.length, color: "#f59e0b" },
            { label: "Open Alerts Scanned", value: totalCandidates, color: "var(--cs-orange)" },
            { label: "FP History Size", value: fpHistorySize, color: "#60a5fa" },
            { label: "Est. Time Saved", value: timeSavedMin > 0 ? `~${timeSavedMin}m` : "—", color: "#1db954" },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--cs-bg)] px-4 py-3 flex flex-col gap-1">
              <div className="font-mono text-[20px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
              <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.08em]">{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Result toast */}
      {lastResult && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-[3px] border font-mono text-[11px] ${lastResult.verdict === "FALSE_POSITIVE" ? "bg-[#1db95410] border-[#1db95430] text-[#1db954]" : "bg-[#f14c4c10] border-[#f14c4c30] text-[#f14c4c]"}`}>
          <CheckCircle className="w-3.5 h-3.5" />
          {lastResult.count} alert{lastResult.count !== 1 ? "s" : ""} marked as {lastResult.verdict.replace("_", " ")}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-[#ff1a1a10] border border-[#ff1a1a30] rounded-[3px]">
          <AlertTriangle className="w-4 h-4 text-[#f14c4c]" />
          <span className="font-mono text-[11px] text-[#f14c4c]">{error}</span>
        </div>
      )}

      {/* Bulk toolbar */}
      {visible.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
          <button onClick={toggleAll} className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--cs-text-dim)] hover:text-[var(--cs-text-dim)] transition-colors">
            {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-[#ff9900]" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? "Deselect all" : `Select all (${visible.length})`}
          </button>

          {selected.size > 0 && (
            <>
              <span className="font-mono text-[10px] text-[var(--cs-text-muted)]">{selected.size} selected</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => void applyBulkVerdict("FALSE_POSITIVE")}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] border border-[#1db95440] bg-[#1db95410] text-[#1db954] hover:bg-[#1db95420] rounded-[2px] transition-colors disabled:opacity-40"
                >
                  {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                  Approve as FP ({selected.size})
                </button>
                <button
                  onClick={() => void applyBulkVerdict("TRUE_POSITIVE")}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] border border-[#f14c4c40] bg-[#f14c4c10] text-[#f14c4c] hover:bg-[#f14c4c20] rounded-[2px] transition-colors disabled:opacity-40"
                >
                  {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
                  Override as TP ({selected.size})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] animate-pulse" />)}
        </div>
      )}

      {/* Suspect list */}
      {!loading && visible.length > 0 && (
        <div className="space-y-2">
          {suspects.map((s) => (
            <SuspectRow
              key={s.id}
              suspect={s}
              selected={selected.has(s.id)}
              onToggle={() => toggleOne(s.id)}
              onSingleVerdict={applySingleVerdict}
              dismissed={dismissed.has(s.id)}
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && visible.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-14 gap-4 border border-[var(--cs-border)] rounded-[3px]">
          {fpHistorySize === 0 ? (
            <>
              <Shield className="w-8 h-8 text-[var(--cs-text-muted)]" />
              <div className="font-mono text-[12px] font-bold text-[var(--cs-text-muted)]">No FP history yet</div>
              <p className="font-mono text-[10px] text-[var(--cs-border2)] text-center max-w-xs">
                Classify some alerts as False Positive from the triage tab — the engine will start suggesting automatically.
              </p>
              <Link href="/alerts"><span className="font-mono text-[10px] text-[#ff9900] hover:opacity-80">Go to Alert Queue →</span></Link>
            </>
          ) : (
            <>
              <CheckCircle className="w-8 h-8 text-[#1db95440]" />
              <div className="font-mono text-[12px] font-bold text-[var(--cs-text-muted)]">No suspects above threshold {threshold}</div>
              <p className="font-mono text-[10px] text-[var(--cs-border2)] text-center max-w-xs">
                All {totalCandidates} open alerts scored below {threshold}. Lower the threshold to cast a wider net.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pattern Library Tab ──────────────────────────────────────────────────────

function PatternLibraryTab() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tacticFilter, setTacticFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"confidence" | "frequency">("confidence");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BASE_URL}/api/fp-engine/patterns`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load patterns");
      const d = await r.json() as { patterns: Pattern[]; summary: Summary };
      setPatterns(d.patterns); setSummary(d.summary);
    } catch (e) { setError(e instanceof Error ? e.message : "Load failed"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const tactics = useMemo(() => ["all", ...new Set(patterns.map((p) => p.mitreAttackTactic))], [patterns]);
  const filtered = useMemo(() => {
    let list = patterns;
    if (tacticFilter !== "all") list = list.filter((p) => p.mitreAttackTactic === tacticFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.type.toLowerCase().includes(q) || p.mitreAttackTechnique.toLowerCase().includes(q) || p.mitreAttackTechniqueId.toLowerCase().includes(q) || p.accounts.some((a) => a.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => sortBy === "confidence" ? b.confidence - a.confidence : b.frequency - a.frequency);
  }, [patterns, search, tacticFilter, sortBy]);

  const fpRate = summary && summary.totalFpAlerts + summary.totalTpAlerts > 0
    ? Math.round((summary.totalFpAlerts / (summary.totalFpAlerts + summary.totalTpAlerts)) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-4 gap-px bg-[var(--cs-surface)] border border-[var(--cs-surface)] rounded-[3px] overflow-hidden">
          {[
            { label: "FP Patterns", value: summary.uniquePatterns, icon: BookOpen, color: "var(--cs-orange)" },
            { label: "FP Verdicts", value: summary.totalFpAlerts, icon: CheckCircle, color: "#1db954" },
            { label: "TP Verdicts", value: summary.totalTpAlerts, icon: Shield, color: "#f14c4c" },
            { label: "Overall FP Rate", value: `${fpRate}%`, icon: TrendingUp, color: fpRate > 60 ? "#1db954" : fpRate > 30 ? "#f59e0b" : "#60a5fa" },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--cs-bg)] px-5 py-4 flex items-center gap-3">
              <s.icon className="w-4 h-4 flex-shrink-0" style={{ color: s.color }} />
              <div>
                <div className="font-mono text-[22px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
                <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.08em] mt-1.5">{s.label.toUpperCase()}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* How it works */}
      <div className="flex items-start gap-3 px-4 py-3 bg-[#ff990008] border border-[#ff990020] rounded-[3px]">
        <Database className="w-3.5 h-3.5 text-[#ff9900] flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-[var(--cs-text-muted)] leading-[1.7]">
          Patterns are extracted from your team's FP verdicts. The engine groups by alert type + MITRE technique and computes
          a <strong className="text-[var(--cs-text-dim)]">confidence %</strong> = FP count ÷ (FP + TP). High-confidence patterns drive the
          auto-suspect scanner and the banner shown on individual alert detail pages.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-[#ff1a1a10] border border-[#ff1a1a30] rounded-[3px]">
          <AlertTriangle className="w-4 h-4 text-[#f14c4c]" />
          <span className="font-mono text-[11px] text-[#f14c4c]">{error}</span>
        </div>
      )}

      {loading && <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-20 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] animate-pulse" />)}</div>}

      {!loading && patterns.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by type, technique, account…" className="w-full pl-9 pr-4 py-2 bg-[var(--cs-surface)] border border-[var(--cs-border)] focus:border-[var(--cs-text-muted)] font-mono text-[11px] text-[var(--cs-text)] placeholder-[var(--cs-border2)] rounded-[2px] outline-none transition-colors" />
            </div>
            <div className="flex items-center gap-1">
              <Filter className="w-3 h-3 text-[var(--cs-text-muted)]" />
              <select value={tacticFilter} onChange={(e) => setTacticFilter(e.target.value)} className="bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[var(--cs-text-dim)] font-mono text-[10px] px-2 py-2 rounded-[2px] outline-none">
                {tactics.map((t) => <option key={t} value={t}>{t === "all" ? "All tactics" : t}</option>)}
              </select>
            </div>
            <div className="flex gap-1">
              {(["confidence", "frequency"] as const).map((s) => (
                <button key={s} onClick={() => setSortBy(s)} className="px-2.5 py-1.5 font-mono text-[9px] rounded-[2px] transition-colors" style={{ backgroundColor: sortBy === s ? "#ff990020" : "transparent", color: sortBy === s ? "var(--cs-orange)" : "var(--cs-text-muted)", border: `1px solid ${sortBy === s ? "#ff990040" : "var(--cs-border)"}` }}>
                  {s === "confidence" ? "By confidence" : "By frequency"}
                </button>
              ))}
            </div>
            <button onClick={() => void load()} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[2px] transition-all">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            <span className="font-mono text-[10px] text-[var(--cs-text-muted)] ml-auto">{filtered.length} of {patterns.length} patterns</span>
          </div>
          <div className="space-y-2">
            {filtered.map((p) => <PatternCard key={p.key} pattern={p} />)}
            {filtered.length === 0 && <div className="flex items-center justify-center h-24 border border-[var(--cs-border)] rounded-[3px]"><span className="font-mono text-[11px] text-[var(--cs-text-muted)]">No patterns match your filters</span></div>}
          </div>
        </>
      )}

      {!loading && patterns.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 border border-[var(--cs-border)] rounded-[3px]">
          <BookOpen className="w-8 h-8 text-[var(--cs-text-muted)]" />
          <div className="font-mono text-[13px] font-bold text-[var(--cs-text-muted)]">No patterns yet</div>
          <p className="font-mono text-[10px] text-[var(--cs-border2)] text-center max-w-sm leading-relaxed">Open any alert, run the AI triage, and mark findings as True or False Positive. Patterns build automatically.</p>
          <Link href="/alerts"><span className="font-mono text-[10px] text-[#ff9900] hover:opacity-80">Go to Alert Queue →</span></Link>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function FpEngine() {
  const [tab, setTab] = useState<"patterns" | "auto-suspect">("auto-suspect");

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div>
        <h1 className="font-mono font-bold text-[20px] tracking-tight text-[var(--cs-text)] flex items-center gap-2.5">
          <BookOpen className="w-5 h-5 text-[#ff9900]" />
          FP LEARNING ENGINE
        </h1>
        <p className="font-mono text-[10px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-0.5">
          Learns from your verdict history · auto-suspects noise · lets your team approve or override in bulk
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-[var(--cs-border)]">
        {([
          { key: "auto-suspect", label: "Auto-Suspect", icon: Zap },
          { key: "patterns",     label: "Pattern Library", icon: BookOpen },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 px-4 pb-2.5 font-mono text-[11px] uppercase tracking-widest border-b-2 transition-colors mr-2"
            style={{ borderColor: tab === key ? "var(--cs-orange)" : "transparent", color: tab === key ? "var(--cs-orange)" : "var(--cs-text-dim)" }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "auto-suspect" ? <AutoSuspectTab /> : <PatternLibraryTab />}
    </div>
  );
}

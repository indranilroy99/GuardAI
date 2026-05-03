/**
 * MITRE ATT&CK Heatmap
 *
 * Visualises your entire alert history mapped against the ATT&CK matrix.
 * Cells are coloured by alert count; click any cell to filter the Alert Queue.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Crosshair, TrendingUp, AlertTriangle, ChevronRight, RefreshCw, Loader2,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── MITRE ATT&CK Baseline ───────────────────────────────────────────────────
// GuardDuty covers a well-defined subset of ATT&CK. We hardcode the scaffold
// so the matrix is always fully rendered, with real-data cells on top.

const TACTICS: { id: string; label: string; shortLabel: string }[] = [
  { id: "Reconnaissance",        label: "Reconnaissance",          shortLabel: "RECON"   },
  { id: "Resource Development",  label: "Resource Development",    shortLabel: "RES DEV" },
  { id: "Initial Access",        label: "Initial Access",          shortLabel: "INIT ACC"},
  { id: "Execution",             label: "Execution",               shortLabel: "EXEC"    },
  { id: "Persistence",           label: "Persistence",             shortLabel: "PERSIST" },
  { id: "Privilege Escalation",  label: "Privilege Escalation",    shortLabel: "PRIV ESC"},
  { id: "Defense Evasion",       label: "Defense Evasion",         shortLabel: "DEF EVA" },
  { id: "Credential Access",     label: "Credential Access",       shortLabel: "CRED ACC"},
  { id: "Discovery",             label: "Discovery",               shortLabel: "DISCOV"  },
  { id: "Lateral Movement",      label: "Lateral Movement",        shortLabel: "LAT MOV" },
  { id: "Collection",            label: "Collection",              shortLabel: "COLLECT" },
  { id: "Command and Control",   label: "Command and Control",     shortLabel: "C2"      },
  { id: "Exfiltration",          label: "Exfiltration",            shortLabel: "EXFIL"   },
  { id: "Impact",                label: "Impact",                  shortLabel: "IMPACT"  },
];

// GuardDuty-relevant techniques per tactic (id, name)
const TECHNIQUE_SCAFFOLD: Record<string, { id: string; name: string }[]> = {
  "Reconnaissance":       [ { id: "T1595", name: "Active Scanning" }, { id: "T1592", name: "Gather Host Info" }, { id: "T1589", name: "Gather Identity Info" } ],
  "Resource Development": [ { id: "T1583", name: "Acquire Infrastructure" }, { id: "T1584", name: "Compromise Infrastructure" }, { id: "T1588", name: "Obtain Capabilities" } ],
  "Initial Access":       [ { id: "T1078", name: "Valid Accounts" }, { id: "T1190", name: "Public-Facing App" }, { id: "T1133", name: "External Remote Services" } ],
  "Execution":            [ { id: "T1204", name: "User Execution" }, { id: "T1059", name: "Command Interpreter" }, { id: "T1072", name: "Deployment Tools" } ],
  "Persistence":          [ { id: "T1098", name: "Account Manipulation" }, { id: "T1136", name: "Create Account" }, { id: "T1525", name: "Implant Image" }, { id: "T1556", name: "Modify Auth Process" } ],
  "Privilege Escalation": [ { id: "T1078", name: "Valid Accounts" }, { id: "T1484", name: "Domain Policy Mod" }, { id: "T1548", name: "Abuse Elevation" } ],
  "Defense Evasion":      [ { id: "T1070", name: "Indicator Removal" }, { id: "T1562", name: "Impair Defenses" }, { id: "T1036", name: "Masquerading" }, { id: "T1078", name: "Valid Accounts" } ],
  "Credential Access":    [ { id: "T1110", name: "Brute Force" }, { id: "T1528", name: "Steal App Token" }, { id: "T1539", name: "Steal Web Session" }, { id: "T1552", name: "Unsecured Credentials" } ],
  "Discovery":            [ { id: "T1087", name: "Account Discovery" }, { id: "T1526", name: "Cloud Service Discovery" }, { id: "T1580", name: "Cloud Infra Discovery" }, { id: "T1613", name: "Container Discovery" } ],
  "Lateral Movement":     [ { id: "T1021", name: "Remote Services" }, { id: "T1534", name: "Internal Spearphishing" }, { id: "T1550", name: "Alt Auth Material" } ],
  "Collection":           [ { id: "T1530", name: "Cloud Storage Data" }, { id: "T1213", name: "Data from Repos" }, { id: "T1114", name: "Email Collection" } ],
  "Command and Control":  [ { id: "T1071", name: "App Layer Protocol" }, { id: "T1572", name: "Protocol Tunneling" }, { id: "T1219", name: "Remote Access Tool" }, { id: "T1568", name: "Dynamic Resolution" } ],
  "Exfiltration":         [ { id: "T1537", name: "Transfer to Cloud" }, { id: "T1048", name: "Alternative Protocol" }, { id: "T1567", name: "Web Service Exfil" } ],
  "Impact":               [ { id: "T1485", name: "Data Destruction" }, { id: "T1496", name: "Resource Hijacking" }, { id: "T1489", name: "Service Stop" }, { id: "T1491", name: "Defacement" } ],
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface HeatCell {
  techniqueId: string;
  technique: string;
  tactic: string;
  count: number;
  bySeverity: Record<string, number>;
  ids: number[];
}

interface HeatmapData {
  cells: HeatCell[];
  totalAlerts: number;
  uniqueTechniques: number;
  uniqueTactics: number;
  hottestTactic: string | null;
  hottestTechnique: { id: string; name: string; count: number } | null;
  tacticCounts: Record<string, number>;
}

// ─── Cell color ───────────────────────────────────────────────────────────────

function cellColor(count: number, maxCount: number): { bg: string; border: string; text: string } {
  if (count === 0) return { bg: "var(--cs-bg)", border: "var(--cs-surface)", text: "var(--cs-border2)" };
  const ratio = Math.min(count / Math.max(maxCount, 1), 1);
  if (ratio < 0.15) return { bg: "#ff99000d", border: "#ff990030", text: "#ff990080" };
  if (ratio < 0.35) return { bg: "#ff990018", border: "#ff990050", text: "var(--cs-orange)" };
  if (ratio < 0.6)  return { bg: "#f59e0b15", border: "#f59e0b50", text: "#fbbf24" };
  if (ratio < 0.8)  return { bg: "#f9731618", border: "#f97316, 60", text: "#fb923c" };
  return { bg: "#ef444418", border: "#ef444460", text: "#f14c4c" };
}

function topSeverity(bySeverity: Record<string, number>): string {
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    if ((bySeverity[sev] ?? 0) > 0) return sev;
  }
  return "LOW";
}

const SEV_DOT: Record<string, string> = {
  CRITICAL: "#f14c4c", HIGH: "#ff8533", MEDIUM: "#fbbf24", LOW: "#60a5fa",
};

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function CellTooltip({ cell }: { cell: HeatCell }) {
  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none">
      <div className="bg-[var(--cs-surface)] border border-[var(--cs-text-muted)] rounded-[3px] px-3 py-2 shadow-xl w-44">
        <div className="font-mono text-[10px] font-bold text-[var(--cs-text)] mb-1">{cell.techniqueId}</div>
        <div className="font-mono text-[9px] text-[var(--cs-text-dim)] mb-2 leading-relaxed">{cell.technique}</div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold text-[var(--cs-text)]">{cell.count} alerts</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SEV_DOT[topSeverity(cell.bySeverity)] }} />
            <span className="font-mono text-[8px]" style={{ color: SEV_DOT[topSeverity(cell.bySeverity)] }}>
              {topSeverity(cell.bySeverity)}
            </span>
          </span>
        </div>
        {Object.entries(cell.bySeverity).length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-[var(--cs-border)] flex gap-2">
            {["CRITICAL","HIGH","MEDIUM","LOW"].filter(s => cell.bySeverity[s]).map(s => (
              <span key={s} className="font-mono text-[8px]" style={{ color: SEV_DOT[s] }}>
                {cell.bySeverity[s]}{s[0]}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 font-mono text-[8px] text-[var(--cs-text-muted)]">Click to view alerts →</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MitreHeatmap() {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [highlightTactic, setHighlightTactic] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE_URL}/api/mitre/heatmap`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load heatmap data");
      setData(await r.json() as HeatmapData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Build cell lookup from real data
  const cellLookup = new Map<string, HeatCell>();
  for (const cell of data?.cells ?? []) {
    cellLookup.set(`${cell.tactic}||${cell.techniqueId}`, cell);
  }

  const maxCount = Math.max(...(data?.cells.map(c => c.count) ?? [1]), 1);

  return (
    <div className="flex flex-col gap-5 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono font-bold text-[20px] tracking-tight text-[var(--cs-text)] flex items-center gap-2.5">
            <Crosshair className="w-5 h-5 text-[#ff9900]" />
            MITRE ATT&CK COVERAGE
          </h1>
          <p className="font-mono text-[10px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-0.5">
            Alert distribution across 14 tactics — click any cell to view matching findings
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[2px] transition-all"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-[#ff1a1a10] border border-[#ff1a1a30] rounded-[3px]">
          <AlertTriangle className="w-4 h-4 text-[#f14c4c]" />
          <span className="font-mono text-[11px] text-[#f14c4c]">{error}</span>
        </div>
      )}

      {/* Stats bar */}
      {data && (
        <div className="grid grid-cols-5 gap-px bg-[var(--cs-border)] border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
          {[
            { label: "Total Alerts",        value: data.totalAlerts,        color: data.totalAlerts > 0 ? "#ff8533" : "var(--cs-text-muted)" },
            { label: "Unique Techniques",   value: data.uniqueTechniques,   color: "var(--cs-orange)" },
            { label: "Tactics Covered",     value: `${data.uniqueTactics}/14`, color: "#8b5cf6" },
            { label: "Hottest Tactic",      value: data.hottestTactic?.split(" ").slice(-1)[0] ?? "—", color: "#f59e0b" },
            { label: "Hottest Technique",   value: data.hottestTechnique?.id ?? "—", color: "#f14c4c" },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--cs-bg)] px-4 py-3">
              <div className="font-mono text-[18px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
              <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-1.5">{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <div className="h-8 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[2px] animate-pulse" />
          {[1,2,3,4].map(i => (
            <div key={i} className="h-16 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[2px] animate-pulse" />
          ))}
        </div>
      )}

      {/* Heatmap matrix */}
      {!loading && data && (
        <div className="overflow-x-auto">
          <div className="min-w-[1100px]">
            {/* Tactic column headers */}
            <div className="grid gap-px mb-px" style={{ gridTemplateColumns: `repeat(${TACTICS.length}, 1fr)` }}>
              {TACTICS.map((tactic) => {
                const count = data.tacticCounts[tactic.id] ?? 0;
                const isHot = tactic.id === data.hottestTactic;
                const isHighlighted = highlightTactic === tactic.id;
                return (
                  <button
                    key={tactic.id}
                    onClick={() => setHighlightTactic(isHighlighted ? null : tactic.id)}
                    className="flex flex-col items-center gap-1 py-2 px-1 border transition-all text-center"
                    style={{
                      backgroundColor: isHighlighted ? "#ff990010" : count > 0 ? "var(--cs-surface)" : "var(--cs-bg)",
                      borderColor: isHighlighted ? "#ff990050" : count > 0 ? "var(--cs-border)" : "var(--cs-bg)",
                    }}
                  >
                    <span
                      className="font-mono text-[8px] font-bold tracking-[0.08em] leading-tight"
                      style={{ color: isHot ? "#f59e0b" : count > 0 ? "var(--cs-text-dim)" : "var(--cs-border2)" }}
                    >
                      {tactic.shortLabel}
                    </span>
                    {count > 0 ? (
                      <span
                        className="font-mono text-[11px] font-bold"
                        style={{ color: isHot ? "#f59e0b" : "var(--cs-text-dim)" }}
                      >
                        {count}
                      </span>
                    ) : (
                      <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">—</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Technique rows — max 4 rows per tactic column */}
            {Array.from({ length: 4 }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className="grid gap-px mb-px"
                style={{ gridTemplateColumns: `repeat(${TACTICS.length}, 1fr)` }}
              >
                {TACTICS.map((tactic) => {
                  const scaffold = TECHNIQUE_SCAFFOLD[tactic.id] ?? [];
                  const tech = scaffold[rowIdx];
                  if (!tech) {
                    return <div key={tactic.id} className="h-14 bg-[var(--cs-bg)]" />;
                  }

                  const cellKey = `${tactic.id}||${tech.id}`;
                  const realCell = cellLookup.get(cellKey);
                  const count = realCell?.count ?? 0;
                  const dimmed = highlightTactic !== null && highlightTactic !== tactic.id;
                  const colors = cellColor(count, maxCount);

                  return (
                    <div
                      key={tech.id + rowIdx}
                      className="relative group"
                      onMouseEnter={() => setHoveredCell(cellKey)}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {realCell ? (
                        <Link href={`/alerts`}>
                          <div
                            className="h-14 flex flex-col justify-between p-1.5 cursor-pointer transition-all border"
                            style={{
                              backgroundColor: dimmed ? "var(--cs-bg)" : colors.bg,
                              borderColor: dimmed ? "var(--cs-surface)" : colors.border,
                              opacity: dimmed ? 0.3 : 1,
                            }}
                          >
                            <div
                              className="font-mono text-[7px] font-bold tracking-wide leading-tight"
                              style={{ color: dimmed ? "var(--cs-border)" : colors.text }}
                            >
                              {tech.id}
                            </div>
                            <div className="flex items-end justify-between">
                              <div
                                className="font-mono text-[7px] leading-tight"
                                style={{ color: dimmed ? "var(--cs-border)" : "var(--cs-text-muted)" }}
                              >
                                {tech.name.length > 14 ? tech.name.slice(0, 13) + "…" : tech.name}
                              </div>
                              <div
                                className="font-mono text-[13px] font-bold leading-none"
                                style={{ color: colors.text }}
                              >
                                {count}
                              </div>
                            </div>
                          </div>
                        </Link>
                      ) : (
                        <div
                          className="h-14 flex flex-col justify-between p-1.5 border"
                          style={{
                            backgroundColor: "var(--cs-bg)",
                            borderColor: "var(--cs-bg)",
                            opacity: dimmed ? 0.2 : 0.6,
                          }}
                        >
                          <div className="font-mono text-[7px] text-[var(--cs-text-muted)] font-bold">{tech.id}</div>
                          <div className="font-mono text-[7px] text-[var(--cs-text-muted)]">
                            {tech.name.length > 14 ? tech.name.slice(0, 13) + "…" : tech.name}
                          </div>
                        </div>
                      )}

                      {/* Tooltip */}
                      {hoveredCell === cellKey && realCell && (
                        <CellTooltip cell={realCell} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Real data cells not in scaffold */}
            {(() => {
              const extra = data.cells.filter(c => {
                const scaffold = TECHNIQUE_SCAFFOLD[c.tactic] ?? [];
                return !scaffold.some(t => t.id === c.techniqueId);
              });
              if (extra.length === 0) return null;
              return (
                <div className="mt-4 space-y-2">
                  <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">
                    ADDITIONAL DETECTED TECHNIQUES ({extra.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {extra.map(c => {
                      const colors = cellColor(c.count, maxCount);
                      return (
                        <Link key={c.techniqueId + c.tactic} href="/alerts">
                          <div
                            className="flex items-center gap-2 px-2 py-1.5 border rounded-[2px] cursor-pointer transition-all hover:opacity-80"
                            style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                          >
                            <span className="font-mono text-[8px] font-bold" style={{ color: colors.text }}>{c.techniqueId}</span>
                            <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{c.technique.slice(0, 20)}</span>
                            <span className="font-mono text-[10px] font-bold" style={{ color: colors.text }}>{c.count}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Legend */}
      {!loading && (
        <div className="flex items-center gap-6 pt-2">
          <span className="font-mono text-[9px] text-[var(--cs-border2)] tracking-[0.1em]">COVERAGE:</span>
          {[
            { label: "No alerts", bg: "var(--cs-bg)", border: "var(--cs-surface)", text: "var(--cs-border2)" },
            { label: "Low (1–2)", bg: "#ff99000d", border: "#ff990030", text: "#ff990080" },
            { label: "Medium (3–5)", bg: "#f59e0b15", border: "#f59e0b50", text: "#fbbf24" },
            { label: "High (6–10)", bg: "#f9731618", border: "#f9731660", text: "#fb923c" },
            { label: "Critical (10+)", bg: "#ef444418", border: "#ef444460", text: "#f14c4c" },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-3 h-3 border rounded-[1px]" style={{ backgroundColor: l.bg, borderColor: l.border }} />
              <span className="font-mono text-[9px]" style={{ color: l.text }}>{l.label}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center gap-2 font-mono text-[9px] text-[var(--cs-border2)]">
            <ChevronRight className="w-3 h-3" />
            Click a tactic header to highlight its column · Click a cell to view alerts
          </div>
        </div>
      )}

      {/* Tactic breakdown table */}
      {data && data.cells.length > 0 && (
        <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--cs-border)] bg-[var(--cs-surface)] flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
            <span className="font-mono text-[11px] font-bold text-[var(--cs-text-dim)] tracking-wider">TACTIC BREAKDOWN</span>
          </div>
          <div className="divide-y divide-[var(--cs-border)]">
            {TACTICS.map(tactic => {
              const count = data.tacticCounts[tactic.id] ?? 0;
              if (count === 0) return null;
              const pct = Math.round((count / data.totalAlerts) * 100);
              const tacticCells = data.cells.filter(c => c.tactic === tactic.id).sort((a, b) => b.count - a.count);
              return (
                <div key={tactic.id} className="flex items-center gap-4 px-4 py-2.5 hover:bg-[var(--cs-surface)] transition-colors">
                  <div className="w-36 font-mono text-[11px] text-[var(--cs-text-dim)] flex-shrink-0">{tactic.label}</div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[var(--cs-border)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: tactic.id === data.hottestTactic ? "#f59e0b" : "var(--cs-orange)",
                        }}
                      />
                    </div>
                    <span className="font-mono text-[9px] text-[var(--cs-text-muted)] w-8 text-right">{pct}%</span>
                  </div>
                  <div className="font-mono text-[13px] font-bold text-[var(--cs-text)] w-8 text-right">{count}</div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {tacticCells.slice(0, 3).map(c => (
                      <span key={c.techniqueId} className="px-1.5 py-[1px] bg-[var(--cs-border)] border border-[var(--cs-text-muted)] rounded-[2px] font-mono text-[7px] text-[var(--cs-text-dim)]">
                        {c.techniqueId}
                      </span>
                    ))}
                    {tacticCells.length > 3 && (
                      <span className="font-mono text-[8px] text-[var(--cs-border2)]">+{tacticCells.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.totalAlerts === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 border border-[var(--cs-border)] rounded-[3px]">
          <Crosshair className="w-8 h-8 text-[var(--cs-text-muted)]" />
          <div className="font-mono text-[13px] font-bold text-[var(--cs-text-muted)]">No alerts to map</div>
          <p className="font-mono text-[10px] text-[var(--cs-border2)] text-center max-w-sm">
            Ingest GuardDuty findings via the webhook or use the Live Findings page to load alerts. The matrix will populate automatically.
          </p>
          <Link href="/aws">
            <span className="font-mono text-[10px] text-[#ff9900] hover:text-[#ff9900]/80 transition-colors">
              Go to Live Findings →
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

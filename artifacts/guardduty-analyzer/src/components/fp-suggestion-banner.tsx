/**
 * FP Suggestion Banner
 *
 * Queries the FP engine for matches against the current alert and renders
 * an evidence panel when matches are found. Designed to be embedded in
 * the Alert Detail page just above the tab content.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronRight, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type Artifact = {
  id: number;
  title: string;
  affectedResource: string;
  accountId: string;
  region: string;
  markedAt: string;
};

type Suggestion = {
  score: number;
  confidence: number;
  matchReasons: string[];
  pattern: { type: string; technique: string; tactic: string; techniqueId: string };
  artifacts: Artifact[];
};

interface Props {
  alertId: number;
  type: string;
  mitreAttackTechniqueId: string;
  accountId: string;
  resourceType: string;
  affectedResource: string;
  currentVerdict?: string | null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FpSuggestionBanner({ alertId, type, mitreAttackTechniqueId, accountId, resourceType, affectedResource, currentVerdict }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${BASE_URL}/api/fp-engine/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ type, mitreAttackTechniqueId, accountId, resourceType, affectedResource, excludeId: alertId }),
    })
      .then((r) => r.json())
      .then((data: { suggestions: Suggestion[] }) => {
        if (!cancelled) setSuggestions(data.suggestions ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [alertId, type, mitreAttackTechniqueId, accountId, resourceType, affectedResource]);

  // Already marked as FP — no need to suggest
  if (currentVerdict === "FALSE_POSITIVE") return null;
  // Loading silently
  if (loading) return null;
  // No matches
  if (suggestions.length === 0 || dismissed) return null;

  const top = suggestions[0]!;
  const totalArtifacts = suggestions.reduce((s, sg) => s + sg.artifacts.length, 0);

  return (
    <div className="mb-5 border border-[#f59e0b40] bg-[#f59e0b08] rounded-[3px] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-mono text-[11px] font-bold text-[#fbbf24]">
            POSSIBLE FALSE POSITIVE
          </span>
          <span className="font-mono text-[10px] text-[#6b7280] ml-2">
            {totalArtifacts} similar alert{totalArtifacts !== 1 ? "s" : ""} previously marked FP
            {top.confidence > 0 && (
              <span className="ml-1 text-[#f59e0b]">· {top.confidence}% FP rate for this type</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href="/fp-engine">
            <span className="font-mono text-[9px] text-[#374151] hover:text-[#6b7280] transition-colors underline cursor-pointer">
              View engine
            </span>
          </Link>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 font-mono text-[9px] text-[#6b7280] hover:text-[#9ca3af] transition-colors px-2 py-1 border border-[#374151] rounded-[2px]"
          >
            {expanded ? "Hide" : "Show"} evidence
            {expanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          </button>
          <button onClick={() => setDismissed(true)} className="text-[#374151] hover:text-[#6b7280] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Evidence panel */}
      {expanded && (
        <div className="border-t border-[#f59e0b20] px-4 py-3 space-y-4">
          {suggestions.map((sg, si) => (
            <div key={si}>
              {/* Match reasons */}
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-mono text-[9px] text-[#374151] tracking-[0.1em]">MATCHED ON</span>
                {sg.matchReasons.map((r) => (
                  <span key={r} className="font-mono text-[8px] px-1.5 py-[2px] bg-[#f59e0b12] border border-[#f59e0b30] text-[#f59e0b] rounded-[2px]">
                    {r}
                  </span>
                ))}
                <span className="font-mono text-[9px] text-[#374151] ml-auto">
                  Score {sg.score}/100 · Confidence {sg.confidence}%
                </span>
              </div>

              {/* Artifacts */}
              <div className="space-y-1">
                {sg.artifacts.map((artifact) => (
                  <Link key={artifact.id} href={`/alerts/${artifact.id}`}>
                    <div className="group flex items-center gap-3 px-3 py-2 bg-[#090b0f] border border-[#1c2030] hover:border-[#f59e0b30] rounded-[2px] cursor-pointer transition-all">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] flex-shrink-0" title="False Positive" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px] text-[#9ca3af] group-hover:text-[#e8eaf0] transition-colors truncate">
                          {artifact.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[8px] text-[#374151]">{artifact.affectedResource}</span>
                          <span className="font-mono text-[8px] text-[#2d3748]">·</span>
                          <span className="font-mono text-[8px] text-[#374151]">{artifact.accountId}</span>
                          <span className="font-mono text-[8px] text-[#2d3748]">·</span>
                          <span className="font-mono text-[8px] text-[#374151]">{timeAgo(artifact.markedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="font-mono text-[8px] px-1 py-[1px] bg-[#22c55e18] border border-[#22c55e30] text-[#22c55e] rounded-[2px]">FP</span>
                        <span className="font-mono text-[8px] text-[#374151]">#{artifact.id}</span>
                        <ChevronRight className="w-3 h-3 text-[#1c2030] group-hover:text-[#f59e0b] transition-colors" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

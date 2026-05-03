import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import { FpSuggestionBanner } from "@/components/fp-suggestion-banner";
import { TriageTimeline, type TriageStage } from "@/components/triage-timeline";
import {
  useGetAlert,
  getGetAlertQueryKey,
  useUpdateAlertStatus,
  useDeleteAlert,
  useInvestigateFinding,
  useFetchResourceDetails,
  useListAlertNotes,
  useCreateAlertNote,
  useDeleteAlertNote,
  getListAlertNotesQueryKey,
  useGetAlertWatchStatus,
  useWatchAlert,
  useUnwatchAlert,
  getGetAlertWatchStatusQueryKey,
  useGetAlertActivity,
  getGetAlertActivityQueryKey,
  AlertSeverity,
  AlertRemediationStatus,
} from "@workspace/api-client-react";
import type { InvestigationReport, ResourceDetails } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAlertsQueryKey, getGetAlertStatsQueryKey } from "@workspace/api-client-react";
import { Loader2, Copy, Check, Trash2, ArrowLeft, StickyNote, Send, X, Bell, History, ShieldCheck, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";

const CREDS_KEY = "sentinelAwsCreds";

const SEV_STYLE = {
  [AlertSeverity.CRITICAL]: { bg: "#ff1a1a18", border: "#ff1a1a40", text: "#f14c4c" },
  [AlertSeverity.HIGH]:     { bg: "#ff6b0018", border: "#ff6b0040", text: "#ff8533" },
  [AlertSeverity.MEDIUM]:   { bg: "#f59e0b18", border: "#f59e0b40", text: "#fbbf24" },
  [AlertSeverity.LOW]:      { bg: "#3b82f618", border: "#3b82f640", text: "#60a5fa" },
};

const STATUS_COLOR = {
  [AlertRemediationStatus.applied]:   "#1db954",
  [AlertRemediationStatus.generated]: "#60a5fa",
  [AlertRemediationStatus.pending]:   "#f59e0b",
  [AlertRemediationStatus.failed]:    "#f14c4c",
};

const SCANNING_STEPS = [
  "Querying CloudTrail events…",
  "Analyzing resource state…",
  "Correlating IAM permissions…",
  "Running threat intelligence…",
  "Generating investigation report…",
];

export function AlertDetail() {
  const { id } = useParams<{ id: string }>();
  const alertId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"description" | "triage" | "investigation" | "raw">("description");
  const [copied, setCopied] = useState(false);
  const [investigationReport, setInvestigationReport] = useState<InvestigationReport | null>(null);
  const [resourceDetails, setResourceDetails] = useState<ResourceDetails | null>(null);
  const [scanStep, setScanStep] = useState(0);
  const [scanInterval, setScanInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [hasCreds, setHasCreds] = useState(false);
  const [noteText, setNoteText] = useState("");

  const { data: alert, isLoading, isError } = useGetAlert(alertId, {
    query: { enabled: !!alertId && !isNaN(alertId), queryKey: getGetAlertQueryKey(alertId) },
  });

  const { data: notes = [] } = useListAlertNotes(alertId, {
    query: { enabled: !!alertId && !isNaN(alertId), queryKey: getListAlertNotesQueryKey(alertId) },
  });

  const { data: activityEvents = [] } = useGetAlertActivity(alertId, {
    query: { enabled: !!alertId && !isNaN(alertId), queryKey: getGetAlertActivityQueryKey(alertId), refetchInterval: 15_000 },
  });

  const updateStatus = useUpdateAlertStatus();
  const deleteAlert = useDeleteAlert();
  const investigate = useInvestigateFinding();
  const fetchResource = useFetchResourceDetails();
  const createNote = useCreateAlertNote();
  const deleteNote = useDeleteAlertNote();
  const watchAlert = useWatchAlert();
  const unwatchAlert = useUnwatchAlert();

  const { data: watchStatus } = useGetAlertWatchStatus(
    alertId,
    { userId: user?.id ?? "" },
    { query: { enabled: !!alertId && !isNaN(alertId) && !!user?.id, queryKey: getGetAlertWatchStatusQueryKey(alertId, { userId: user?.id ?? "" }) } }
  );

  function handleToggleWatch() {
    if (!user) return;
    if (watchStatus?.watching) {
      unwatchAlert.mutate(
        { id: alertId, params: { userId: user.id } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetAlertWatchStatusQueryKey(alertId, { userId: user.id }) });
            toast({ title: "Stopped watching alert" });
          },
          onError: () => toast({ title: "Failed to unwatch alert", variant: "destructive" }),
        }
      );
    } else {
      watchAlert.mutate(
        { id: alertId, data: { userId: user.id, userName: user.username } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetAlertWatchStatusQueryKey(alertId, { userId: user.id }) });
            toast({ title: "Watching alert — you'll be notified of changes" });
          },
          onError: () => toast({ title: "Failed to watch alert", variant: "destructive" }),
        }
      );
    }
  }

  function handleAddNote() {
    if (!noteText.trim() || !user) return;
    createNote.mutate(
      { id: alertId, data: { authorId: user.id, authorName: user.username, content: noteText.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAlertNotesQueryKey(alertId) });
          setNoteText("");
          toast({ title: "Note added" });
        },
        onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
      }
    );
  }

  function handleDeleteNote(noteId: number) {
    deleteNote.mutate(
      { id: alertId, noteId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAlertNotesQueryKey(alertId) });
          toast({ title: "Note removed" });
        },
        onError: () => toast({ title: "Failed to remove note", variant: "destructive" }),
      }
    );
  }

  useEffect(() => {
    setHasCreds(!!localStorage.getItem(CREDS_KEY));
  }, []);

  useEffect(() => {
    return () => { if (scanInterval) clearInterval(scanInterval); };
  }, [scanInterval]);

  const sevStyle = SEV_STYLE[alert?.severity as keyof typeof SEV_STYLE] || SEV_STYLE[AlertSeverity.LOW];
  const statusColor = STATUS_COLOR[alert?.remediationStatus as keyof typeof STATUS_COLOR] || "var(--cs-text-dim)";

  function handleCopy() {
    if (!alert) return;
    navigator.clipboard.writeText(alert.remediationScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied to clipboard" });
  }

  function handleUpdateStatus(s: AlertRemediationStatus) {
    updateStatus.mutate(
      { id: alertId, data: { remediationStatus: s } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetAlertQueryKey(alertId), data);
          queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey() });
          toast({ title: `Status → ${s}` });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      }
    );
  }

  function handleDelete() {
    if (!window.confirm("Permanently remove this alert?")) return;
    deleteAlert.mutate(
      { id: alertId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey() });
          toast({ title: "Alert removed" });
          setLocation("/alerts");
        },
        onError: () => toast({ title: "Delete failed", variant: "destructive" }),
      }
    );
  }

  function handleInvestigate() {
    if (!alert) return;
    const stored = localStorage.getItem(CREDS_KEY);
    if (!stored) {
      toast({ title: "AWS credentials required", description: "Connect via Live Findings first.", variant: "destructive" });
      return;
    }
    const creds = JSON.parse(stored);
    setScanStep(0);
    const iv = setInterval(() => setScanStep(p => Math.min(p + 1, SCANNING_STEPS.length - 1)), 1400);
    setScanInterval(iv);

    investigate.mutate(
      {
        data: {
          credentials: creds,
          resourceId: alert.affectedResource,
          resourceType: alert.resourceType as any,
          alertId,
        },
      },
      {
        onSuccess: (report) => {
          clearInterval(iv);
          setScanInterval(null);
          setInvestigationReport(report);
        },
        onError: (err: any) => {
          clearInterval(iv);
          setScanInterval(null);
          toast({ title: "Investigation failed", description: err?.message, variant: "destructive" });
        },
      }
    );
  }

  function handleFetchResource() {
    if (!alert) return;
    const stored = localStorage.getItem(CREDS_KEY);
    if (!stored) {
      toast({ title: "AWS credentials required", variant: "destructive" });
      return;
    }
    const creds = JSON.parse(stored);
    fetchResource.mutate(
      { data: { credentials: creds, resourceType: alert.resourceType as any, resourceId: alert.affectedResource } },
      {
        onSuccess: (details) => setResourceDetails(details),
        onError: (err: any) => toast({ title: "Resource fetch failed", description: err?.message, variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-32 bg-[var(--cs-surface2)] rounded" />
        <div className="h-8 w-2/3 bg-[var(--cs-surface2)] rounded" />
        <div className="h-[400px] bg-[var(--cs-surface)] rounded border border-[var(--cs-border)]" />
      </div>
    );
  }

  if (isError || !alert) {
    return (
      <div className="p-5 bg-[#ff1a1a18] border border-[#ff1a1a40] rounded-[3px] text-[#f14c4c] font-mono text-[13px]">
        ALERT NOT FOUND OR FAILED TO LOAD
      </div>
    );
  }

  return (
    <div className="w-full pb-12">
      {/* Back */}
      <Link href="/alerts">
        <span className="flex items-center gap-1 text-[12px] font-mono text-[var(--cs-text-dim)] hover:text-[var(--cs-text-dim)] cursor-pointer mb-5 w-fit transition-colors">
          <ArrowLeft className="w-3 h-3" /> ALERT QUEUE
        </span>
      </Link>

      {/* Title bar */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="px-2 py-[2px] rounded-[2px] font-mono text-[11px] font-semibold uppercase border"
            style={{ backgroundColor: sevStyle.bg, borderColor: sevStyle.border, color: sevStyle.text }}
          >
            {alert.severity}
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="font-mono text-[12px]" style={{ color: statusColor }}>{alert.remediationStatus}</span>
          </div>
          <span className="font-mono text-[11px] text-[var(--cs-text-muted)]">#{alert.id}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Watch toggle */}
          <button
            onClick={handleToggleWatch}
            disabled={watchAlert.isPending || unwatchAlert.isPending}
            className="flex items-center gap-1.5 text-[12px] font-mono transition-colors disabled:opacity-50"
            style={{ color: watchStatus?.watching ? "var(--cs-orange)" : "var(--cs-text-dim)" }}
            title={watchStatus?.watching ? `Watching · ${watchStatus.watcherCount} watcher${watchStatus.watcherCount !== 1 ? "s" : ""}` : "Watch this alert for changes"}
          >
            {watchAlert.isPending || unwatchAlert.isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : watchStatus?.watching
                ? <Bell className="w-3 h-3" fill="currentColor" />
                : <Bell className="w-3 h-3" />}
            {watchStatus?.watching ? "WATCHING" : "WATCH"}
            {watchStatus?.watcherCount !== undefined && watchStatus.watcherCount > 0 && (
              <span
                className="ml-0.5 px-1 py-px rounded-sm font-mono text-[9px] font-semibold"
                style={{ background: watchStatus.watching ? "var(--cs-orange)20" : "var(--cs-surface2)", color: watchStatus.watching ? "var(--cs-orange)" : "var(--cs-text-muted)" }}
              >
                {watchStatus.watcherCount}
              </span>
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteAlert.isPending}
            className="flex items-center gap-1.5 text-[12px] font-mono text-[var(--cs-text-dim)] hover:text-[#f14c4c] transition-colors disabled:opacity-50"
          >
            {deleteAlert.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            REMOVE
          </button>
        </div>
      </div>

      <h1 className="text-[15px] font-semibold text-[var(--cs-text)] leading-snug mb-1">{alert.title}</h1>
      <div className="font-mono text-[11px] text-[var(--cs-text-muted)] mb-6 flex items-center gap-2 flex-wrap">
        <span>{alert.type}</span>
        <span>·</span>
        <span>{alert.region}</span>
        <span>·</span>
        <span>{alert.accountId}</span>
        <span>·</span>
        <span>Detected {format(new Date(alert.createdAt), "yyyy-MM-dd HH:mm")}</span>
      </div>

      <div className="h-[1px] w-full bg-[var(--cs-border)] mb-6" />

      {/* FP Learning Engine suggestion banner */}
      <FpSuggestionBanner
        alertId={alert.id}
        type={alert.type}
        mitreAttackTechniqueId={(alert as any).mitreAttackTechniqueId ?? ""}
        accountId={alert.accountId}
        resourceType={alert.resourceType}
        affectedResource={alert.affectedResource}
        currentVerdict={(alert as any).verdict}
      />

      {/* Two-column layout */}
      <div className="grid grid-cols-10 gap-6">
        {/* Main (70%) */}
        <div className="col-span-7 space-y-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-[var(--cs-border)] mb-5">
            {(["description", "triage", "investigation", "raw"] as const).map(tab => {
              const triageStatus = (alert as any).triageStatus;
              const isTriageRunning = tab === "triage" && triageStatus && !["idle", "complete", "error"].includes(triageStatus);
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex items-center gap-1.5 px-4 pb-2.5 font-mono text-[12px] uppercase tracking-widest border-b-2 transition-colors mr-2"
                  style={{
                    borderColor: activeTab === tab ? "var(--cs-orange)" : "transparent",
                    color: activeTab === tab ? "var(--cs-orange)" : "var(--cs-text-dim)",
                  }}
                >
                  {tab}
                  {isTriageRunning && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ff9900] animate-pulse" />
                  )}
                  {tab === "triage" && (alert as any).verdict && (
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      (alert as any).verdict === "TRUE_POSITIVE" ? "bg-[#f14c4c]"
                      : (alert as any).verdict === "FALSE_POSITIVE" ? "bg-[#1db954]"
                      : "bg-[#f59e0b]"
                    }`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Triage tab */}
          {activeTab === "triage" && (
            <div className="space-y-4">
              <TriageTimeline
                triageStatus={(alert as any).triageStatus ?? "idle"}
                triageStages={(() => {
                  const raw = (alert as any).triageStages;
                  if (!raw) return [];
                  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
                })()}
                verdict={(alert as any).verdict}
                verdictConfidence={(alert as any).verdictConfidence}
                source={(alert as any).source}
              />
            </div>
          )}

          {/* Description tab */}
          {activeTab === "description" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] mb-1 font-mono">FINDING TYPE</div>
                  <div className="font-mono text-[12px] text-[var(--cs-text)] break-all">{alert.type}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] mb-1 font-mono">AFFECTED RESOURCE</div>
                  <div className="font-mono text-[12px] text-[var(--cs-text)] break-all">{alert.affectedResource}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] mb-1 font-mono">RESOURCE TYPE</div>
                  <div className="font-mono text-[12px] text-[var(--cs-text)]">{alert.resourceType}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] mb-1 font-mono">REGION</div>
                  <div className="font-mono text-[12px] text-[var(--cs-text)]">{alert.region}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] mb-1 font-mono">DESCRIPTION</div>
                  <div className="text-[13px] text-[var(--cs-text-dim)] leading-relaxed">{alert.description}</div>
                </div>
              </div>
            </div>
          )}

          {/* Investigation tab */}
          {activeTab === "investigation" && (
            <div className="space-y-4">
              {!investigationReport && !investigate.isPending && (
                <div className="p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] space-y-3">
                  <div className="text-[11px] font-mono text-[var(--cs-text-dim)]">
                    Runs CloudTrail correlation, resource inspection, and AI threat analysis for this finding.
                    {!hasCreds && (
                      <span className="text-[#f59e0b] ml-2">
                        AWS credentials required — <Link href="/aws"><span className="underline cursor-pointer">connect first</span></Link>
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleInvestigate}
                    disabled={!hasCreds}
                    className="px-4 py-2 border border-[#ff990040] bg-[#ff990018] text-[#ff9900] font-mono text-[11px] uppercase tracking-widest rounded-[3px] hover:bg-[#ff990030] transition-colors disabled:opacity-40"
                  >
                    RUN INVESTIGATION
                  </button>
                </div>
              )}

              {investigate.isPending && (
                <div className="p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] space-y-3">
                  {SCANNING_STEPS.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div
                        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: i < scanStep ? "#1db954" : i === scanStep ? "var(--cs-orange)" : "var(--cs-border)",
                        }}
                      />
                      <span
                        className="font-mono text-[12px] transition-colors"
                        style={{ color: i < scanStep ? "#1db954" : i === scanStep ? "var(--cs-orange)" : "var(--cs-text-muted)" }}
                      >
                        {step}
                      </span>
                      {i === scanStep && <Loader2 className="w-3 h-3 animate-spin text-[#ff9900] ml-auto" />}
                    </div>
                  ))}
                </div>
              )}

              {investigationReport && (
                <div className="space-y-4">
                  {/* Summary + Risk score */}
                  <div className="p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">EXECUTIVE SUMMARY</div>
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">RISK</div>
                        <div className="font-mono text-[13px] font-bold" style={{
                          color: investigationReport.riskScore >= 80 ? "#f14c4c" : investigationReport.riskScore >= 50 ? "#fbbf24" : "#1db954"
                        }}>
                          {investigationReport.riskScore}/100
                        </div>
                      </div>
                    </div>
                    <div className="h-1.5 bg-[var(--cs-surface)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${investigationReport.riskScore}%`,
                          backgroundColor: investigationReport.riskScore >= 80 ? "#f14c4c" : investigationReport.riskScore >= 50 ? "#fbbf24" : "#1db954"
                        }}
                      />
                    </div>
                    <div className="text-[13px] text-[var(--cs-text-dim)] leading-relaxed">{investigationReport.summary}</div>
                  </div>

                  {/* IOCs */}
                  {investigationReport.indicators.length > 0 && (
                    <div className="p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] space-y-2">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-3">INDICATORS OF COMPROMISE</div>
                      {investigationReport.indicators.map((ind, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className="w-[5px] h-[5px] rounded-full bg-[#f14c4c] mt-1.5 flex-shrink-0" />
                          <span className="font-mono text-[12px] text-[var(--cs-text)]">{ind}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Timeline */}
                  {investigationReport.timeline.length > 0 && (
                    <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
                      <div className="px-4 py-2.5 bg-[var(--cs-surface)] border-b border-[var(--cs-border)]">
                        <span className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">EVENT TIMELINE ({investigationReport.timeline.length})</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-[var(--cs-bg)] border-b border-[var(--cs-border)]">
                            <tr>
                              <th className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">TIME</th>
                              <th className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">EVENT</th>
                              <th className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">SOURCE IP</th>
                              <th className="px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">OUTCOME</th>
                            </tr>
                          </thead>
                          <tbody>
                            {investigationReport.timeline.map((ev, i) => (
                              <tr key={i} className="border-b border-[var(--cs-surface)] last:border-0 hover:bg-[var(--cs-surface)]">
                                <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--cs-text-dim)] whitespace-nowrap">
                                  {format(new Date(ev.timestamp), "MM-dd HH:mm:ss")}
                                </td>
                                <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--cs-text)]">{ev.eventName}</td>
                                <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--cs-text-dim)]">{ev.sourceIPAddress || "—"}</td>
                                <td className="px-4 py-2.5 font-mono text-[11px]" style={{
                                  color: ev.outcome === "SUCCESS" ? "#1db954" : "#f14c4c"
                                }}>
                                  {ev.outcome}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {investigationReport.recommendations.length > 0 && (
                    <div className="p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] space-y-2">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-3">RECOMMENDATIONS</div>
                      {investigationReport.recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <span className="font-mono text-[11px] text-[#ff9900] flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-[13px] text-[var(--cs-text-dim)] leading-relaxed">{rec}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => { setInvestigationReport(null); }}
                    className="text-[11px] font-mono text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors"
                  >
                    CLEAR REPORT
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Raw tab */}
          {activeTab === "raw" && (
            <div className="rounded-[3px] overflow-hidden border border-[var(--cs-border)]">
              <div className="px-4 py-2 bg-[var(--cs-bg)] border-b border-[var(--cs-border)] flex items-center justify-between">
                <span className="font-mono text-[12px] text-[var(--cs-text-dim)]">raw_alert.json</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(alert.rawAlert); toast({ title: "Copied" }); }}
                  className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-4 overflow-x-auto max-h-[500px] overflow-y-auto bg-[var(--cs-bg)]" style={{ scrollbarWidth: "none" }}>
                <pre className="font-mono text-[12px] text-[var(--cs-text-dim)] leading-relaxed whitespace-pre-wrap break-all">
                  {(() => { try { return JSON.stringify(JSON.parse(alert.rawAlert), null, 2); } catch { return alert.rawAlert; } })()}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar (30%) */}
        <div className="col-span-3 space-y-4">
          {/* MITRE ATT&CK */}
          <div className="p-4 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]" style={{ borderTop: "2px solid #ff9900" }}>
            <div className="text-[10px] uppercase tracking-widest font-mono text-[#ff9900] mb-3">MITRE ATT&CK</div>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-0.5">TACTIC</div>
                <div className="text-[13px] font-semibold text-[#ff9900]">{alert.mitreAttackTactic}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-0.5">TECHNIQUE</div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] text-[var(--cs-text)]">{alert.mitreAttackTechnique}</span>
                  <span className="font-mono text-[10px] bg-[var(--cs-surface2)] px-1.5 py-[2px] border border-[var(--cs-border)] rounded-[2px] text-[var(--cs-text-dim)] whitespace-nowrap flex-shrink-0">
                    {alert.mitreAttackTechniqueId}
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-[var(--cs-border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-1">MITIGATION</div>
                <div className="text-[12px] text-[var(--cs-text-dim)] leading-relaxed">{alert.mitreAttackMitigation}</div>
              </div>
            </div>
          </div>

          {/* Remediation Script */}
          <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
            <div className="px-3 py-2 bg-[var(--cs-bg)] border-b border-[var(--cs-border)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[11px] text-[var(--cs-text-dim)] truncate">remediation.py</span>
                <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-[2px] rounded-sm tracking-wider" style={{ background: "#f59e0b18", border: "1px solid #f59e0b40", color: "#f59e0b" }}>
                  INTERNAL REVIEW
                </span>
              </div>
              <button onClick={handleCopy} className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors flex-shrink-0" title="Copy to clipboard">
                {copied ? <Check className="w-3.5 h-3.5 text-[#1db954]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="px-3 py-1.5 flex items-center gap-2" style={{ background: "var(--cs-bg)", borderBottom: "1px solid var(--cs-border)" }}>
              <span className="text-[9px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                ⚠ Script requires internal review before execution. Copy to clipboard and run in a controlled environment.
              </span>
            </div>
            <div className="max-h-[320px] overflow-y-auto overflow-x-auto bg-[var(--cs-bg)]" style={{ scrollbarWidth: "none" }}>
              <pre className="p-3 font-mono text-[11px] text-[var(--cs-text-dim)] leading-relaxed whitespace-pre">
                <code>{alert.remediationScript}</code>
              </pre>
            </div>
          </div>

          {/* Workflow Status */}
          <div className="p-4 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
            <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-3">WORKFLOW STATUS</div>
            <div className="space-y-1">
              {(["pending","generated","applied","failed"] as AlertRemediationStatus[]).map(s => {
                const isActive = alert.remediationStatus === s;
                const color = STATUS_COLOR[s];
                return (
                  <button
                    key={s}
                    onClick={() => handleUpdateStatus(s)}
                    disabled={updateStatus.isPending || isActive}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-[3px] border transition-colors text-left"
                    style={{
                      backgroundColor: isActive ? `${color}18` : "transparent",
                      borderColor: isActive ? `${color}40` : "var(--cs-border)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: isActive ? color : "var(--cs-border)" }} />
                      <span className="font-mono text-[12px] uppercase" style={{ color: isActive ? color : "var(--cs-text-muted)" }}>
                        {s}
                      </span>
                    </div>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resource Details */}
          <div className="p-4 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">LIVE RESOURCE</div>
              <button
                onClick={handleFetchResource}
                disabled={fetchResource.isPending || !hasCreds}
                className="text-[10px] font-mono uppercase text-[#ff9900] hover:opacity-80 transition-opacity disabled:opacity-30"
              >
                {fetchResource.isPending ? "FETCHING…" : "FETCH"}
              </button>
            </div>
            {!hasCreds && (
              <div className="text-[11px] font-mono text-[var(--cs-text-muted)]">
                <Link href="/aws"><span className="text-[#ff9900] underline cursor-pointer">Connect AWS</span></Link> to inspect live state
              </div>
            )}
            {resourceDetails && (
              <div className="space-y-2 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-[var(--cs-text-muted)]">STATE</span>
                  <span className="text-[#1db954]">{resourceDetails.state || "—"}</span>
                </div>
                {resourceDetails.networkInfo && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--cs-text-muted)]">PRIVATE IP</span>
                      <span className="text-[var(--cs-text)]">{resourceDetails.networkInfo.privateIp || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--cs-text-muted)]">PUBLIC IP</span>
                      <span className="text-[var(--cs-text)]">{resourceDetails.networkInfo.publicIp || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--cs-text-muted)]">VPC</span>
                      <span className="text-[var(--cs-text-dim)]">{resourceDetails.networkInfo.vpcId || "—"}</span>
                    </div>
                  </>
                )}
                {resourceDetails.iamInfo && (
                  <div>
                    <div className="text-[var(--cs-text-muted)] mb-1">POLICIES</div>
                    {(resourceDetails.iamInfo.attachedPolicies ?? []).slice(0, 3).map((p, i) => (
                      <div key={i} className="text-[var(--cs-text-dim)] truncate pl-2">· {p.split("(")[0].trim()}</div>
                    ))}
                  </div>
                )}
                {Object.entries(resourceDetails.attributes || {}).slice(0, 3).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-[var(--cs-text-muted)] capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span className="text-[var(--cs-text-dim)] truncate max-w-[100px]" title={v}>{v || "—"}</span>
                  </div>
                ))}
                {resourceDetails.tags && resourceDetails.tags.length > 0 && (
                  <div>
                    <div className="text-[var(--cs-text-muted)] mb-1">TAGS</div>
                    {resourceDetails.tags.slice(0, 3).map((t, i) => (
                      <div key={i} className="text-[var(--cs-text-dim)] truncate pl-2">· {t.key}: {t.value}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Analyst Notes */}
          <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden" style={{ borderTop: "2px solid var(--cs-orange)" }}>
            <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "var(--cs-surface)", borderBottom: "1px solid var(--cs-border)" }}>
              <StickyNote className="w-3 h-3" style={{ color: "var(--cs-orange)" }} />
              <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--cs-orange)" }}>
                ANALYST NOTES
              </span>
              {notes.length > 0 && (
                <span className="ml-auto text-[9px] font-mono px-1.5 py-[1px] rounded-sm" style={{ background: "var(--cs-orange)22", color: "var(--cs-orange)", border: "1px solid var(--cs-orange)44" }}>
                  {notes.length}
                </span>
              )}
            </div>

            {/* Notes list */}
            <div className="max-h-[280px] overflow-y-auto" style={{ background: "var(--cs-bg)", scrollbarWidth: "none" }}>
              {notes.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                  No notes yet
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--cs-border)" }}>
                  {notes.map(note => (
                    <div key={note.id} className="px-3 py-2.5 group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0" style={{ background: "var(--cs-orange)22", color: "var(--cs-orange)", border: "1px solid var(--cs-orange)44" }}>
                            {note.authorName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[10px] font-mono font-semibold" style={{ color: "var(--cs-text-dim)" }}>
                            {note.authorName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                            {format(new Date(note.createdAt), "MM-dd HH:mm")}
                          </span>
                          {user && note.authorId === user.id && (
                            <button
                              onClick={() => handleDeleteNote(note.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ color: "var(--cs-text-muted)" }}
                              title="Delete note"
                            >
                              <X className="w-3 h-3 hover:text-[#f14c4c]" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--cs-text-dim)" }}>
                        {note.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Note input */}
            <div className="p-2.5" style={{ background: "var(--cs-surface)", borderTop: "1px solid var(--cs-border)" }}>
              <div className="flex gap-2">
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAddNote(); } }}
                  placeholder="Add investigation note… (⌘+Enter to submit)"
                  rows={2}
                  className="flex-1 text-[12px] font-mono resize-none rounded-[2px] px-2.5 py-1.5 outline-none"
                  style={{
                    background: "var(--cs-bg)",
                    border: "1px solid var(--cs-border)",
                    color: "var(--cs-text)",
                    caretColor: "var(--cs-orange)",
                  }}
                />
                <button
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || createNote.isPending}
                  className="flex items-center justify-center w-8 rounded-[2px] transition-colors disabled:opacity-30"
                  style={{ background: "var(--cs-orange)22", border: "1px solid var(--cs-orange)44", color: "var(--cs-orange)" }}
                  title="Add note (⌘+Enter)"
                >
                  {createNote.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          {/* Change History Timeline */}
          <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden" style={{ borderTop: "2px solid var(--cs-blue)" }}>
            <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: "var(--cs-surface)", borderBottom: "1px solid var(--cs-border)" }}>
              <History className="w-3 h-3" style={{ color: "var(--cs-blue)" }} />
              <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--cs-blue)" }}>
                CHANGE HISTORY
              </span>
              {activityEvents.length > 0 && (
                <span className="ml-auto text-[9px] font-mono px-1.5 py-[1px] rounded-sm" style={{ background: "var(--cs-blue)22", color: "var(--cs-blue)", border: "1px solid var(--cs-blue)44" }}>
                  {activityEvents.length}
                </span>
              )}
            </div>

            <div className="max-h-[320px] overflow-y-auto" style={{ background: "var(--cs-bg)", scrollbarWidth: "none" }}>
              {activityEvents.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <History className="w-5 h-5 mx-auto mb-2 opacity-20" style={{ color: "var(--cs-text-muted)" }} />
                  <p className="text-[11px] font-mono" style={{ color: "var(--cs-text-muted)" }}>No changes recorded yet.</p>
                  <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--cs-text-muted)" }}>Status updates, notes, and verdict changes will appear here.</p>
                </div>
              ) : (
                <div className="relative px-3 py-3">
                  {/* Vertical guide line */}
                  <div
                    className="absolute left-[22px] top-3 bottom-3 w-px"
                    style={{ background: "var(--cs-border)" }}
                  />

                  <div className="space-y-0">
                    {activityEvents.map((event, idx) => {
                      const dotColors: Record<string, string> = {
                        status_change: "var(--cs-blue)",
                        note_added: "var(--cs-green)",
                        verdict_changed: "var(--cs-orange)",
                      };
                      const bgColors: Record<string, string> = {
                        status_change: "var(--cs-blue)18",
                        note_added: "var(--cs-green)18",
                        verdict_changed: "var(--cs-orange)18",
                      };
                      const icons: Record<string, React.ReactNode> = {
                        status_change: <ShieldCheck className="w-2.5 h-2.5" />,
                        note_added: <MessageSquare className="w-2.5 h-2.5" />,
                        verdict_changed: <Bell className="w-2.5 h-2.5" />,
                      };
                      const dotColor = dotColors[event.eventType] ?? "var(--cs-text-muted)";
                      const bgColor = bgColors[event.eventType] ?? "var(--cs-surface2)";
                      const icon = icons[event.eventType] ?? <History className="w-2.5 h-2.5" />;
                      const isLast = idx === activityEvents.length - 1;

                      return (
                        <div key={event.id} className={`flex gap-3 ${isLast ? "" : "pb-4"}`}>
                          {/* Dot */}
                          <div className="flex-shrink-0 relative z-10">
                            <div
                              className="w-[18px] h-[18px] rounded-full flex items-center justify-center"
                              style={{ background: bgColor, border: `1px solid ${dotColor}`, color: dotColor }}
                            >
                              {icon}
                            </div>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pt-[1px]">
                            <p className="text-[11px] font-mono leading-snug" style={{ color: "var(--cs-text)" }}>
                              {event.description}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-[9px] font-mono font-semibold" style={{ color: dotColor }}>
                                {event.triggeredByName}
                              </span>
                              <span className="text-[9px] font-mono" style={{ color: "var(--cs-text-muted)" }}>·</span>
                              <span className="text-[9px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                                {format(new Date(event.createdAt), "yyyy-MM-dd HH:mm")}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

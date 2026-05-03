/**
 * Threat Hunt Page
 *
 * Natural-language threat hunting + scheduled hunt management.
 * Type a query → AI interprets → DB searched → intelligence summary generated.
 * Save any query as a scheduled hunt (hourly/daily/weekly) with optional webhook.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Search, Crosshair, ChevronRight, Download, Loader2,
  AlertTriangle, Shield, Clock, RefreshCw, Copy, Check,
  BarChart3, Target, Brain, Terminal, Bell, BellDot,
  CalendarClock, Trash2, Pause, Play, Webhook, X,
  ChevronDown, ChevronUp,
  ArrowRight, KeyRound, Upload, Pickaxe, AlertOctagon,
  Lock, Zap, CheckCircle, Server,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ───────────────────────────────────────────────────────────────────

interface HuntFilters {
  timeRange: string;
  severities: string[];
  mitreTactics: string[];
  resourceTypes: string[];
  keywords: string[];
  accountId: string | null;
  verdictFilter: string | null;
  interpretation: string;
  huntTitle: string;
}

interface HuntAlert {
  id: number;
  title: string;
  severity: string;
  type: string;
  mitreAttackTactic: string;
  mitreAttackTechnique: string;
  mitreAttackTechniqueId: string;
  affectedResource: string;
  resourceType: string;
  region: string;
  accountId: string;
  verdict: string | null;
  verdictConfidence: number | null;
  triageStatus: string;
  remediationStatus: string;
  createdAt: string;
}

interface HuntResult {
  query: string;
  filters: HuntFilters;
  results: HuntAlert[];
  summary: string;
  totalFound: number;
  searchedAt: string;
}

interface ScheduledHunt {
  id: number;
  name: string;
  query: string;
  schedule: "hourly" | "daily" | "weekly";
  enabled: boolean;
  notifyWebhook: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  lastMatchCount: number;
  createdAt: string;
}

interface HuntNotification {
  id: number;
  scheduledHuntId: number;
  huntName: string;
  query: string;
  findingsCount: number;
  newFindingsCount: number;
  summary: string;
  read: boolean;
  webhookSent: boolean;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HUNT_TEMPLATES = [
  { label: "Lateral Movement",        query: "show all lateral movement and privilege escalation in the last 7 days",        Icon: ArrowRight,     color: "#f14c4c" },
  { label: "Compromised Credentials", query: "find compromised IAM credentials and unauthorized access attempts",             Icon: KeyRound,       color: "#ff6b00" },
  { label: "Data Exfiltration",       query: "detect data exfiltration and suspicious S3 activity in the last 30 days",      Icon: Upload,         color: "#f59e0b" },
  { label: "Crypto Mining",           query: "find cryptocurrency mining activity and unusual compute usage",                  Icon: Pickaxe,        color: "#8b5cf6" },
  { label: "Recon Activity",          query: "show discovery and reconnaissance activity in the last 24 hours",               Icon: Search,         color: "#60a5fa" },
  { label: "Critical Unreviewed",     query: "all critical and high severity alerts that haven't been triaged yet",           Icon: AlertOctagon,   color: "#f14c4c" },
  { label: "Persistence",            query: "find persistence mechanisms and backdoor installations this month",              Icon: Lock,           color: "#1db954" },
  { label: "Brute Force",            query: "credential brute force and password spraying attacks this week",                Icon: Zap,            color: "#f59e0b" },
  { label: "True Positives",         query: "show only confirmed true positive findings from the last 30 days",              Icon: CheckCircle,    color: "#1db954" },
  { label: "EC2 Threats",            query: "threats targeting EC2 instances including port scans and malware",              Icon: Server,         color: "var(--cs-orange)" },
];

const PLACEHOLDER_QUERIES = [
  "show me all lateral movement in the last 7 days...",
  "find compromised IAM credentials...",
  "detect cryptocurrency mining activity...",
  "data exfiltration from S3 buckets this month...",
  "critical findings that haven't been triaged...",
  "privilege escalation attempts last 24 hours...",
];

const SEV_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  CRITICAL: { bg: "#ff1a1a10", border: "#ff1a1a40", text: "#f14c4c" },
  HIGH:     { bg: "#ff6b0010", border: "#ff6b0040", text: "#ff8533" },
  MEDIUM:   { bg: "#f59e0b10", border: "#f59e0b40", text: "#fbbf24" },
  LOW:      { bg: "#3b82f610", border: "#3b82f640", text: "#60a5fa" },
};

const SCHEDULE_LABELS: Record<string, string> = { hourly: "Every hour", daily: "Every day", weekly: "Every week" };

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-[3px] bg-[#ff990010] border border-[#ff990030] rounded-[2px] font-mono text-[9px]">
      <span className="text-[var(--cs-text-muted)]">{label}:</span>
      <span className="text-[#ff9900]">{value}</span>
    </span>
  );
}

function SeverityBar({ results }: { results: HuntAlert[] }) {
  const counts = results.reduce<Record<string, number>>((acc, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc; }, {});
  const total = results.length;
  return (
    <div className="flex h-2 rounded-full overflow-hidden gap-px">
      {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sev) => {
        const count = counts[sev] ?? 0;
        if (!count) return null;
        const s = SEV_STYLE[sev]!;
        return <div key={sev} style={{ width: `${(count / total) * 100}%`, backgroundColor: s.text, opacity: 0.8 }} title={`${sev}: ${count}`} />;
      })}
    </div>
  );
}

function TimelineBar({ results }: { results: HuntAlert[] }) {
  if (results.length === 0) return null;
  const sorted = [...results].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const earliest = new Date(sorted[0]!.createdAt).getTime();
  const latest = new Date(sorted[sorted.length - 1]!.createdAt).getTime();
  const span = latest - earliest || 1;
  const BUCKETS = 30;
  const buckets = Array.from({ length: BUCKETS }, () => ({ count: 0, critical: false }));
  for (const a of results) {
    const pos = Math.min(BUCKETS - 1, Math.floor(((new Date(a.createdAt).getTime() - earliest) / span) * (BUCKETS - 1)));
    buckets[pos]!.count++;
    if (a.severity === "CRITICAL" || a.severity === "HIGH") buckets[pos]!.critical = true;
  }
  const maxCount = Math.max(...buckets.map((b) => b.count));
  return (
    <div className="flex items-end gap-px h-10">
      {buckets.map((b, i) => (
        <div key={i} className="flex-1 rounded-[1px]"
          style={{ height: `${Math.max(4, (b.count / maxCount) * 100)}%`, backgroundColor: b.critical ? "#f14c4c" : b.count > 0 ? "var(--cs-orange)" : "var(--cs-border)", opacity: b.count > 0 ? 0.8 : 0.3 }}
          title={`${b.count} alerts`} />
      ))}
    </div>
  );
}

// ─── Schedule Modal ───────────────────────────────────────────────────────────

function ScheduleModal({
  query,
  onClose,
  onSaved,
}: {
  query: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(() => {
    const words = query.trim().split(" ").slice(0, 5).join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  });
  const [schedule, setSchedule] = useState<"hourly" | "daily" | "weekly">("daily");
  const [webhook, setWebhook] = useState("");
  const [runNow, setRunNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const save = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${BASE_URL}/api/hunt/schedules`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), query, schedule, notifyWebhook: webhook.trim() || null, runNow }),
      });
      if (!r.ok) { const e = await r.json() as { error: string }; throw new Error(e.error); }
      toast({ title: "Hunt scheduled", description: `"${name}" will run ${SCHEDULE_LABELS[schedule]!.toLowerCase()}` });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[4px] w-[480px] max-w-[95vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--cs-border)]">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#8b5cf6]" />
            <span className="font-mono text-[13px] font-bold text-[var(--cs-text)]">SCHEDULE THIS HUNT</span>
          </div>
          <button onClick={onClose} className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Query preview */}
          <div className="px-3 py-2.5 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[3px]">
            <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.1em] mb-1">HUNT QUERY</div>
            <div className="font-mono text-[11px] text-[var(--cs-text-dim)] leading-relaxed line-clamp-2">{query}</div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">HUNT NAME</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] focus:border-[#8b5cf660] rounded-[3px] font-mono text-[12px] text-[var(--cs-text)] outline-none transition-colors"
              placeholder="e.g. Daily Lateral Movement Hunt"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-1.5">
            <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">RUN FREQUENCY</label>
            <div className="grid grid-cols-3 gap-2">
              {(["hourly", "daily", "weekly"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSchedule(s)}
                  className={`py-2.5 font-mono text-[11px] font-bold rounded-[3px] border transition-all ${
                    schedule === s
                      ? "bg-[#8b5cf615] border-[#8b5cf6] text-[#8b5cf6]"
                      : "bg-[var(--cs-bg)] border-[var(--cs-border)] text-[var(--cs-text-muted)] hover:border-[var(--cs-text-muted)]"
                  }`}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="font-mono text-[9px] text-[var(--cs-border2)]">
              {schedule === "hourly" && "Runs every 60 minutes — best for high-traffic environments"}
              {schedule === "daily" && "Runs once per day — recommended for most hunt queries"}
              {schedule === "weekly" && "Runs every 7 days — good for long-range historical hunts"}
            </p>
          </div>

          {/* Webhook */}
          <div className="space-y-1.5">
            <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em] flex items-center gap-1.5">
              <Webhook className="w-3 h-3" /> WEBHOOK URL
              <span className="text-[var(--cs-border2)]">(optional)</span>
            </label>
            <input
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] focus:border-[#8b5cf660] rounded-[3px] font-mono text-[11px] text-[var(--cs-text)] outline-none transition-colors placeholder:text-[var(--cs-border2)]"
              placeholder="https://hooks.slack.com/... or any HTTP endpoint"
            />
            <p className="font-mono text-[9px] text-[var(--cs-border2)]">
              POST with findings JSON when the hunt matches alerts. Works with Slack, Teams, PagerDuty, n8n, Zapier.
            </p>
          </div>

          {/* Run now toggle */}
          <div className="flex items-center justify-between py-2.5 px-3 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[3px]">
            <div>
              <div className="font-mono text-[11px] text-[var(--cs-text-dim)]">Run immediately</div>
              <div className="font-mono text-[9px] text-[var(--cs-text-muted)]">Execute this hunt right now, then continue on schedule</div>
            </div>
            <button
              onClick={() => setRunNow((v) => !v)}
              className={`w-10 h-5 rounded-full transition-all relative ${runNow ? "bg-[#8b5cf6]" : "bg-[var(--cs-border)]"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${runNow ? "left-5" : "left-0.5"}`} />
            </button>
          </div>

          {error && <p className="font-mono text-[10px] text-[#f14c4c]">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--cs-border)]">
          <button onClick={onClose} className="px-4 py-2 font-mono text-[11px] text-[var(--cs-text-muted)] border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[3px] transition-all">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] disabled:opacity-50 text-white font-mono font-bold text-[11px] rounded-[3px] transition-all"
          >
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><CalendarClock className="w-3.5 h-3.5" /> Schedule Hunt</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Notifications Panel ──────────────────────────────────────────────────────

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const [notifs, setNotifs] = useState<HuntNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const r = await fetch(`${BASE_URL}/api/hunt/notifications`, { credentials: "include" });
    if (r.ok) setNotifs(await r.json() as HuntNotification[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const markAllRead = async () => {
    await fetch(`${BASE_URL}/api/hunt/notifications/read-all`, { method: "POST", credentials: "include" });
    setNotifs((n) => n.map((x) => ({ ...x, read: true })));
    toast({ title: "All notifications marked read" });
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="ml-auto w-[420px] max-w-[95vw] h-full bg-[var(--cs-surface)] border-l border-[var(--cs-border)] shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--cs-border)]">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#8b5cf6]" />
            <span className="font-mono text-[12px] font-bold text-[var(--cs-text)]">HUNT NOTIFICATIONS</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void markAllRead()} className="font-mono text-[9px] text-[var(--cs-text-muted)] hover:text-[#ff9900] transition-colors">
              Mark all read
            </button>
            <button onClick={onClose} className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)]"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-20 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[3px] animate-pulse" />)}</div>}
          {!loading && notifs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Bell className="w-8 h-8 text-[var(--cs-text-muted)]" />
              <p className="font-mono text-[11px] text-[var(--cs-text-muted)]">No notifications yet</p>
              <p className="font-mono text-[9px] text-[var(--cs-border2)] text-center max-w-[200px]">Scheduled hunts will appear here when they run and find matches</p>
            </div>
          )}
          {notifs.map((n) => (
            <div key={n.id} className={`p-3 border rounded-[3px] transition-all ${n.read ? "bg-[var(--cs-bg)] border-[var(--cs-border)] opacity-60" : "bg-[var(--cs-surface)] border-[#8b5cf640]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] flex-shrink-0" />}
                    <span className="font-mono text-[11px] font-bold text-[var(--cs-text)] truncate">{n.huntName}</span>
                    {n.webhookSent && <span className="px-1 py-[1px] bg-[#ff990010] border border-[#ff990030] rounded-[2px] font-mono text-[7px] text-[#ff9900] flex-shrink-0">WEBHOOK ✓</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`font-mono text-[11px] font-bold ${n.findingsCount > 0 ? "text-[#ff8533]" : "text-[#1db954]"}`}>{n.findingsCount}</span>
                    <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">findings</span>
                    {n.newFindingsCount > 0 && (
                      <span className="font-mono text-[9px] text-[#8b5cf6]">+{n.newFindingsCount} new</span>
                    )}
                    <span className="font-mono text-[8px] text-[var(--cs-border2)]">· {new Date(n.createdAt).toLocaleDateString()} {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="font-mono text-[9px] text-[var(--cs-text-muted)] mt-1.5 leading-relaxed line-clamp-3">{n.summary}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Scheduled Hunts Panel ────────────────────────────────────────────────────

function ScheduledHuntsPanel({ onAddQuery }: { onAddQuery: (q: string) => void }) {
  const [schedules, setSchedules] = useState<ScheduledHunt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const r = await fetch(`${BASE_URL}/api/hunt/schedules`, { credentials: "include" });
    if (r.ok) setSchedules(await r.json() as ScheduledHunt[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (id: number, enabled: boolean) => {
    const r = await fetch(`${BASE_URL}/api/hunt/schedules/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (r.ok) { setSchedules((s) => s.map((x) => x.id === id ? { ...x, enabled } : x)); }
  };

  const remove = async (id: number, name: string) => {
    await fetch(`${BASE_URL}/api/hunt/schedules/${id}`, { method: "DELETE", credentials: "include" });
    setSchedules((s) => s.filter((x) => x.id !== id));
    toast({ title: `"${name}" removed` });
  };

  if (loading) return null;
  if (schedules.length === 0) return null;

  return (
    <div className="border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--cs-surface)] hover:bg-[var(--cs-surface2)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5 text-[#8b5cf6]" />
          <span className="font-mono text-[11px] font-bold text-[var(--cs-text-dim)]">SCHEDULED HUNTS</span>
          <span className="px-1.5 py-[1px] bg-[#8b5cf615] border border-[#8b5cf630] rounded-full font-mono text-[8px] text-[#8b5cf6]">
            {schedules.length}
          </span>
          <span className="px-1.5 py-[1px] bg-[#1db95410] border border-[#1db95430] rounded-full font-mono text-[8px] text-[#1db954]">
            {schedules.filter((s) => s.enabled).length} active
          </span>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />}
      </button>

      {expanded && (
        <div className="border-t border-[var(--cs-border)] divide-y divide-[var(--cs-border)]">
          {schedules.map((s) => (
            <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.enabled ? "bg-[var(--cs-bg)]" : "bg-[var(--cs-bg)] opacity-50"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-[var(--cs-text-dim)] truncate">{s.name}</span>
                  <span className={`px-1.5 py-[1px] rounded-full font-mono text-[7px] border ${s.enabled ? "bg-[#1db95410] border-[#1db95430] text-[#1db954]" : "bg-[var(--cs-border)] border-[var(--cs-text-muted)] text-[var(--cs-text-muted)]"}`}>
                    {s.enabled ? "ACTIVE" : "PAUSED"}
                  </span>
                  <span className="px-1.5 py-[1px] bg-[#8b5cf610] border border-[#8b5cf630] rounded-full font-mono text-[7px] text-[#8b5cf6]">
                    {s.schedule.toUpperCase()}
                  </span>
                  {s.notifyWebhook && <Webhook className="w-2.5 h-2.5 text-[var(--cs-text-muted)]" aria-label="Webhook configured" />}
                </div>
                <div className="font-mono text-[9px] text-[var(--cs-text-muted)] truncate mt-0.5">{s.query}</div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="font-mono text-[8px] text-[var(--cs-border2)]">
                    {s.lastRunAt ? `Last run: ${new Date(s.lastRunAt).toLocaleDateString()}` : "Never run"}
                  </span>
                  {s.lastMatchCount > 0 && <span className="font-mono text-[8px] text-[#ff8533]">{s.lastMatchCount} findings last run</span>}
                  <span className="font-mono text-[8px] text-[var(--cs-border2)]">
                    Next: {new Date(s.nextRunAt).toLocaleDateString()} {new Date(s.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => void onAddQuery(s.query)}
                  className="p-1.5 text-[var(--cs-text-muted)] hover:text-[#ff9900] border border-[var(--cs-border)] hover:border-[#ff990030] rounded-[2px] transition-all"
                  title="Run now"
                >
                  <Search className="w-3 h-3" />
                </button>
                <button
                  onClick={() => void toggle(s.id, !s.enabled)}
                  className="p-1.5 text-[var(--cs-text-muted)] hover:text-[#f59e0b] border border-[var(--cs-border)] hover:border-[#f59e0b30] rounded-[2px] transition-all"
                  title={s.enabled ? "Pause" : "Resume"}
                >
                  {s.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => void remove(s.id, s.name)}
                  className="p-1.5 text-[var(--cs-text-muted)] hover:text-[#f14c4c] border border-[var(--cs-border)] hover:border-[#ff1a1a30] rounded-[2px] transition-all"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ThreatHunt() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HuntResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [huntStage, setHuntStage] = useState<"idle" | "interpreting" | "querying" | "summarizing">("idle");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [schedulesKey, setSchedulesKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Cycle placeholder text
  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_QUERIES.length), 3000);
    return () => clearInterval(t);
  }, []);

  // Poll unread notification count
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const r = await fetch(`${BASE_URL}/api/hunt/notifications`, { credentials: "include" });
        if (r.ok) {
          const data = await r.json() as HuntNotification[];
          setUnreadCount(data.filter((n) => !n.read).length);
        }
      } catch { /* ignore */ }
    };
    void fetchUnread();
    const t = setInterval(() => void fetchUnread(), 30_000);
    return () => clearInterval(t);
  }, []);

  const runHunt = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 3) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setHuntStage("interpreting");
    try {
      const t1 = setTimeout(() => setHuntStage("querying"), 1200);
      const t2 = setTimeout(() => setHuntStage("summarizing"), 2400);
      const r = await fetch(`${BASE_URL}/api/hunt`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      clearTimeout(t1); clearTimeout(t2);
      if (!r.ok) { const e = await r.json() as { error: string }; throw new Error(e.error); }
      const data = await r.json() as HuntResult;
      setResult(data);
      setHuntStage("idle");
      if (data.totalFound === 0) toast({ title: "No findings matched", description: "Try broadening the time range or adjusting your query." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hunt failed");
      setHuntStage("idle");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const exportResults = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hunt-${result.filters.huntTitle.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySummary = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const STAGE_LABELS: Record<string, string> = {
    interpreting: "Interpreting query with AI…",
    querying: "Searching alert database…",
    summarizing: "Generating intelligence summary…",
  };

  return (
    <>
      {showScheduleModal && (
        <ScheduleModal
          query={query || (result?.query ?? "")}
          onClose={() => setShowScheduleModal(false)}
          onSaved={() => setSchedulesKey((k) => k + 1)}
        />
      )}
      {showNotifications && (
        <NotificationsPanel onClose={() => { setShowNotifications(false); setUnreadCount(0); }} />
      )}

      <div className="flex flex-col gap-5 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono font-bold text-[20px] tracking-tight text-[var(--cs-text)] flex items-center gap-2.5">
              <Crosshair className="w-5 h-5 text-[#ff9900]" />
              THREAT HUNT
            </h1>
            <p className="font-mono text-[10px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-0.5">
              Ask in plain English · AI interprets · Database searched · Schedule for recurring alerts
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--cs-text-muted)]">
                <Clock className="w-3 h-3" />
                {new Date(result.searchedAt).toLocaleTimeString()}
              </div>
            )}
            {/* Notification bell */}
            <button
              onClick={() => setShowNotifications(true)}
              className="relative p-2 text-[var(--cs-text-muted)] hover:text-[#8b5cf6] border border-[var(--cs-border)] hover:border-[#8b5cf630] rounded-[3px] transition-all"
              title="Hunt notifications"
            >
              {unreadCount > 0
                ? <BellDot className="w-4 h-4 text-[#8b5cf6]" />
                : <Bell className="w-4 h-4" />
              }
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#8b5cf6] rounded-full font-mono text-[8px] text-white flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <div className={`flex items-center gap-3 px-4 py-3.5 bg-[var(--cs-bg)] border-2 rounded-[4px] transition-all ${loading ? "border-[#ff990060]" : "border-[var(--cs-border)] focus-within:border-[#ff990060]"}`}>
            {loading
              ? <Loader2 className="w-4 h-4 text-[#ff9900] animate-spin flex-shrink-0" />
              : <Search className="w-4 h-4 text-[var(--cs-text-muted)] flex-shrink-0" />
            }
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !loading) void runHunt(query); }}
              disabled={loading}
              className="flex-1 bg-transparent font-mono text-[14px] text-[var(--cs-text)] outline-none placeholder:text-[var(--cs-border2)]"
              placeholder={PLACEHOLDER_QUERIES[placeholderIdx]}
              autoFocus spellCheck={false}
            />
            {/* Schedule button */}
            {(query.trim().length >= 3 || result) && !loading && (
              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-[#8b5cf6] border border-[#8b5cf630] hover:bg-[#8b5cf610] font-mono text-[10px] font-bold rounded-[2px] transition-all flex-shrink-0"
                title="Schedule this hunt"
              >
                <CalendarClock className="w-3.5 h-3.5" /> SCHEDULE
              </button>
            )}
            <button
              onClick={() => void runHunt(query)}
              disabled={loading || !query.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 disabled:opacity-30 text-[#0f1923] font-mono font-bold text-[11px] tracking-wider rounded-[2px] transition-all flex-shrink-0"
            >
              {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> HUNTING…</> : <><Crosshair className="w-3.5 h-3.5" /> HUNT</>}
            </button>
          </div>
          {loading && huntStage !== "idle" && (
            <div className="absolute -bottom-7 left-0 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#ff9900] animate-pulse" />
              <span className="font-mono text-[10px] text-[#ff9900]">{STAGE_LABELS[huntStage]}</span>
            </div>
          )}
        </div>

        {/* Hunt templates */}
        {!result && !loading && (
          <div className="space-y-3">
            <div className="font-mono text-[9px] text-[var(--cs-border2)] tracking-[0.15em]">HUNT TEMPLATES</div>
            <div className="grid grid-cols-5 gap-2">
              {HUNT_TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => { setQuery(t.query); void runHunt(t.query); }}
                  className="group flex flex-col gap-1.5 p-3 bg-[var(--cs-surface)] border border-[var(--cs-border)] hover:border-[#ff990030] rounded-[3px] text-left transition-all hover:bg-[var(--cs-surface2)]">
                  <div className="flex items-center justify-between">
                    <t.Icon className="w-3.5 h-3.5" style={{ color: t.color }} />
                    <ChevronRight className="w-2.5 h-2.5 text-[var(--cs-text-muted)] group-hover:text-[#ff9900] transition-colors" />
                  </div>
                  <div className="font-mono text-[10px] font-bold text-[var(--cs-text-dim)] group-hover:text-[var(--cs-text-dim)] transition-colors leading-tight">{t.label}</div>
                  <div className="font-mono text-[8px] text-[var(--cs-border2)] leading-relaxed line-clamp-2">{t.query}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {["w-2/3", "w-full", "w-1/2"].map((w) => <div key={w} className={`h-3 ${w} bg-[var(--cs-border)] rounded animate-pulse`} />)}
            <div className="mt-6 space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] animate-pulse" />)}</div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex items-center gap-3 p-4 bg-[#ff1a1a10] border border-[#ff1a1a30] rounded-[3px]">
            <AlertTriangle className="w-4 h-4 text-[#f14c4c] flex-shrink-0" />
            <div>
              <div className="font-mono text-[11px] font-bold text-[#f14c4c]">Hunt Failed</div>
              <div className="font-mono text-[10px] text-[var(--cs-text-muted)] mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Findings",     value: result.totalFound, icon: <Target className="w-4 h-4" />, color: result.totalFound > 0 ? "#f14c4c" : "#1db954" },
                { label: "Critical/High", value: result.results.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH").length, icon: <AlertTriangle className="w-4 h-4" />, color: "#ff6b00" },
                { label: "Time Range",   value: result.filters.timeRange.toUpperCase(), icon: <Clock className="w-4 h-4" />, color: "var(--cs-orange)" },
                { label: "AI Provider",  value: "Llama 3.3 / GPT-4o", icon: <Brain className="w-4 h-4" />, color: "var(--cs-text-dim)" },
              ].map((s) => (
                <div key={s.label} className="bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] p-3 flex items-center gap-2.5">
                  <span style={{ color: s.color }}>{s.icon}</span>
                  <div>
                    <div className="font-mono text-[18px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
                    <div className="font-mono text-[8px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-0.5">{s.label.toUpperCase()}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="font-mono text-[8px] text-[var(--cs-border2)] tracking-[0.1em]">FILTERS APPLIED:</span>
              <FilterChip label="range" value={result.filters.timeRange} />
              {result.filters.severities.map((s) => <FilterChip key={s} label="severity" value={s} />)}
              {result.filters.mitreTactics.map((t) => <FilterChip key={t} label="tactic" value={t} />)}
              {result.filters.resourceTypes.map((r) => <FilterChip key={r} label="resource" value={r} />)}
              {result.filters.keywords.map((k) => <FilterChip key={k} label="keyword" value={k} />)}
              {result.filters.accountId && <FilterChip label="account" value={result.filters.accountId} />}
              {result.filters.verdictFilter && <FilterChip label="verdict" value={result.filters.verdictFilter} />}
              {/* Schedule shortcut */}
              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex items-center gap-1 px-2 py-[3px] bg-[#8b5cf610] border border-[#8b5cf630] hover:bg-[#8b5cf620] rounded-[2px] font-mono text-[9px] text-[#8b5cf6] transition-all"
              >
                <CalendarClock className="w-2.5 h-2.5" /> Schedule this hunt
              </button>
            </div>

            {/* Timeline */}
            {result.results.length > 1 && (
              <div className="bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3 text-[var(--cs-text-muted)]" />
                    <span className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">ACTIVITY TIMELINE</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 font-mono text-[8px] text-[var(--cs-text-muted)]"><span className="w-2 h-1.5 bg-[#f14c4c] rounded-[1px] inline-block" /> HIGH/CRIT</span>
                    <span className="flex items-center gap-1 font-mono text-[8px] text-[var(--cs-text-muted)]"><span className="w-2 h-1.5 bg-[#ff9900] rounded-[1px] inline-block" /> OTHER</span>
                  </div>
                </div>
                <TimelineBar results={result.results} />
                <SeverityBar results={result.results} />
              </div>
            )}

            {/* AI Summary */}
            <div className="bg-[var(--cs-surface)] border border-[#ff990020] rounded-[3px] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--cs-border)] bg-[#ff990005]">
                <div className="flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5 text-[#ff9900]" />
                  <span className="font-mono text-[11px] font-bold text-[#ff9900] tracking-wider">AI INTELLIGENCE SUMMARY</span>
                  <span className="px-1.5 py-[1px] bg-[#ff990015] border border-[#ff990030] rounded-[2px] font-mono text-[8px] text-[#ff9900]">{result.filters.huntTitle}</span>
                </div>
                <button onClick={copySummary} className="p-1 text-[var(--cs-text-muted)] hover:text-[#ff9900] transition-colors" title="Copy summary">
                  {copied ? <Check className="w-3.5 h-3.5 text-[#1db954]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="p-4">
                <p className="font-mono text-[11px] text-[var(--cs-text-dim)] leading-[1.8] whitespace-pre-wrap">{result.summary}</p>
              </div>
            </div>

            {/* Findings list */}
            {result.results.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">MATCHED FINDINGS ({result.results.length})</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => void runHunt(query)} className="flex items-center gap-1 px-2 py-1 font-mono text-[9px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[2px] transition-all">
                      <RefreshCw className="w-2.5 h-2.5" /> Re-hunt
                    </button>
                    <button onClick={exportResults} className="flex items-center gap-1 px-2 py-1 font-mono text-[9px] text-[var(--cs-text-muted)] hover:text-[#ff9900] border border-[var(--cs-border)] hover:border-[#ff990030] rounded-[2px] transition-all">
                      <Download className="w-2.5 h-2.5" /> Export JSON
                    </button>
                  </div>
                </div>

                {result.results.map((alert) => {
                  const sevStyle = SEV_STYLE[alert.severity] ?? SEV_STYLE.LOW!;
                  return (
                    <Link key={alert.id} href={`/alerts/${alert.id}`}>
                      <div className="group flex items-center gap-3 px-4 py-3 bg-[var(--cs-surface)] border border-[var(--cs-border)] hover:border-[#ff990030] rounded-[3px] cursor-pointer transition-all hover:bg-[var(--cs-surface2)]">
                        <span className="px-1.5 py-[2px] rounded-[2px] font-mono text-[8px] font-bold flex-shrink-0"
                          style={{ backgroundColor: sevStyle.bg, color: sevStyle.text, border: `1px solid ${sevStyle.border}` }}>
                          {alert.severity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12px] font-bold text-[var(--cs-text)] truncate group-hover:text-[#fff]">{alert.title}</span>
                            {alert.verdict?.includes("TRUE_POSITIVE") && (
                              <span className="px-1 py-[1px] bg-[#ff1a1a15] border border-[#ff1a1a30] rounded-[2px] font-mono text-[7px] text-[#f14c4c] flex-shrink-0">CONFIRMED</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{alert.mitreAttackTactic}</span>
                            <span className="font-mono text-[9px] text-[var(--cs-border2)]">·</span>
                            <span className="font-mono text-[9px] text-[var(--cs-text-muted)] truncate">{alert.affectedResource}</span>
                            <span className="font-mono text-[9px] text-[var(--cs-border2)]">·</span>
                            <span className="font-mono text-[9px] text-[var(--cs-text-muted)]">{alert.region}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <div className="font-mono text-[9px] text-[var(--cs-text-muted)]">#{alert.id}</div>
                            <div className="font-mono text-[8px] text-[var(--cs-border2)]">{new Date(alert.createdAt).toLocaleDateString()}</div>
                          </div>
                          {alert.verdictConfidence != null && (
                            <div className="flex items-center gap-1">
                              <div className="w-12 h-1 bg-[var(--cs-border)] rounded-full overflow-hidden">
                                <div className="h-full rounded-full"
                                  style={{ width: `${alert.verdictConfidence}%`, backgroundColor: alert.verdictConfidence >= 80 ? "#1db954" : alert.verdictConfidence >= 50 ? "#f59e0b" : "var(--cs-text-muted)" }} />
                              </div>
                              <span className="font-mono text-[8px] text-[var(--cs-text-muted)]">{alert.verdictConfidence}%</span>
                            </div>
                          )}
                          <ChevronRight className="w-3.5 h-3.5 text-[var(--cs-text-muted)] group-hover:text-[#ff9900] transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-3 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
                <Shield className="w-8 h-8 text-[#1db954]" />
                <div className="font-mono text-[13px] font-bold text-[#1db954]">No findings matched</div>
                <div className="font-mono text-[10px] text-[var(--cs-text-muted)] max-w-sm text-center">{result.filters.interpretation}</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setResult(null)} className="px-3 py-1.5 font-mono text-[10px] text-[var(--cs-text-muted)] border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[2px] transition-all">New Hunt</button>
                  <button onClick={() => { setQuery("all critical and high alerts last 30 days"); void runHunt("all critical and high alerts last 30 days"); }}
                    className="px-3 py-1.5 font-mono text-[10px] text-[#ff9900] border border-[#ff990030] hover:bg-[#ff990010] rounded-[2px] transition-all">
                    Broaden Search
                  </button>
                </div>
              </div>
            )}

            {result.results.length > 0 && (
              <button onClick={() => { setResult(null); setQuery(""); inputRef.current?.focus(); }}
                className="w-full py-2.5 font-mono text-[11px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] border border-[var(--cs-border)] hover:border-[var(--cs-text-muted)] rounded-[3px] transition-all flex items-center justify-center gap-2">
                <Search className="w-3.5 h-3.5" /> Start a New Hunt
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <Terminal className="w-6 h-6 text-[var(--cs-text-muted)]" />
            <p className="font-mono text-[10px] text-[var(--cs-border2)]">Type a query above or click a template to begin hunting</p>
            <p className="font-mono text-[9px] text-[var(--cs-text-muted)]">Powered by Llama 3.3 / GPT-4o · Searches your full alert history</p>
          </div>
        )}

        {/* Scheduled hunts panel */}
        <ScheduledHuntsPanel key={schedulesKey} onAddQuery={(q) => { setQuery(q); void runHunt(q); }} />
      </div>
    </>
  );
}

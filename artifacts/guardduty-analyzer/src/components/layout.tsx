import { ReactNode, useEffect, useState, useMemo, useRef } from "react";
import { Link, useLocation } from "wouter";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useListAlerts, useGetAlertStats, useGetUserNotifications, getGetUserNotificationsQueryKey } from "@workspace/api-client-react";
import type { AlertActivityEvent } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useGlobalFilters, type Timeframe } from "@/lib/global-filters-context";
import {
  LogOut, Activity, LayoutDashboard, Radio, BellRing,
  Network, Search, BarChart2, Crosshair, BookOpen,
  Bot, Plug, Server, Terminal, ShieldCheck, HelpCircle,
  Bell, Sun, Moon, ChevronLeft, ChevronRight, Filter, X,
} from "lucide-react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayoutProps { children: ReactNode }

function GuardAILogo({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" className={cn("flex-shrink-0 guardai-logo", collapsed ? "w-5 h-5" : "w-6 h-6")}>
      <path
        d="M14 1.5L25 6.8V15.5C25 21.4 20.1 25.6 14 27.5C7.9 25.6 3 21.4 3 15.5V6.8L14 1.5Z"
        style={{ fill: "var(--cs-bg)", stroke: "var(--cs-orange)" }}
        strokeWidth="1.4"
      />
      <path d="M14 14 Q17 10 20 14" stroke="var(--cs-orange)" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
      <path d="M14 14 Q17 8  21 14" stroke="var(--cs-orange)" strokeWidth="0.8" strokeLinecap="round" opacity="0.3"/>
      <circle cx="14" cy="14" r="1.5" fill="var(--cs-orange)"/>
      <line x1="14" y1="14" x2="20" y2="10" stroke="var(--cs-orange)" strokeWidth="1" strokeLinecap="round" opacity="0.8"/>
    </svg>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | null;
  badgeColor?: string;
};
type NavGroup = { label: string; items: NavItem[] };

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1d": "Last 24h",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
};

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [awsConnected, setAwsConnected] = useState(false);
  const [agentActive, setAgentActive] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("guardai-sidebar-collapsed") === "1"; } catch { return false; }
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string>(() => {
    try { return localStorage.getItem("guardai-notif-last-checked") ?? new Date(0).toISOString(); } catch { return new Date(0).toISOString(); }
  });
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { filters, setAccountId, setTimeframe } = useGlobalFilters();

  useEffect(() => {
    setAwsConnected(!!localStorage.getItem("guardaiAwsCreds"));
    setAgentActive(!!localStorage.getItem("guardaiAgentConfig"));
  }, [location]);

  useEffect(() => {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(`${basePath}/api/alerts/stream`, { withCredentials: true });
    es.addEventListener("connected", () => setSseConnected(true));
    es.onerror = () => setSseConnected(false);
    return () => es.close();
  }, []);

  // Notifications (watched alert activity)
  const notifParams = useMemo(() => ({ userId: user?.id ?? "" }), [user?.id]);
  const { data: notifEvents = [] } = useGetUserNotifications(notifParams, {
    query: {
      enabled: !!user?.id,
      refetchInterval: 30_000,
      queryKey: getGetUserNotificationsQueryKey(notifParams),
    },
  });
  const unreadCount = useMemo(
    () => notifEvents.filter((e: AlertActivityEvent) => e.createdAt > lastCheckedAt).length,
    [notifEvents, lastCheckedAt]
  );

  // Close panel on outside click
  useEffect(() => {
    if (!notifOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [notifOpen]);

  function openNotifPanel() {
    setNotifOpen(true);
    const now = new Date().toISOString();
    setLastCheckedAt(now);
    try { localStorage.setItem("guardai-notif-last-checked", now); } catch {}
  }

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("guardai-sidebar-collapsed", next ? "1" : "0"); } catch {}
  }

  const { data: alerts } = useListAlerts();
  const pendingAlerts = alerts?.filter(a => a.remediationStatus === "pending")?.length ?? 0;
  const criticalAlerts = alerts?.filter(a => a.severity === "CRITICAL" && a.remediationStatus !== "applied")?.length ?? 0;

  // Active accounts badge — respects global timeframe filter
  const statsParams = useMemo(() => {
    const days = ({ "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as Record<Timeframe, number>)[filters.timeframe];
    return {
      since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      ...(filters.accountId !== "all" ? { accountId: filters.accountId } : {}),
    };
  }, [filters.accountId, filters.timeframe]);
  const { data: globalStats } = useGetAlertStats(statsParams);
  const activeAccountCount = (globalStats as { activeAccountCount?: number } | undefined)?.activeAccountCount ?? 0;

  const navGroups: NavGroup[] = [
    {
      label: "Security Operations",
      items: [
        { href: "/",            label: "Dashboard",     icon: LayoutDashboard },
        { href: "/aws",         label: "Live Findings",  icon: Radio },
        { href: "/alerts",      label: "Alert Queue",    icon: BellRing,   badge: pendingAlerts > 0 ? String(pendingAlerts) : null, badgeColor: "var(--cs-orange)" },
        { href: "/incidents",   label: "Incidents",      icon: Network },
        { href: "/analyze",     label: "Analyzer",       icon: Search },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { href: "/mitre",       label: "ATT&CK Matrix",  icon: BarChart2 },
        { href: "/hunt",        label: "Threat Hunt",    icon: Crosshair },
        { href: "/fp-engine",   label: "FP Engine",      icon: BookOpen },
        { href: "/agents",      label: "AI Agents",      icon: Bot,  badge: agentActive ? "ON" : null, badgeColor: "var(--cs-green)" },
        { href: "/integrations",label: "Integrations",   icon: Plug, badge: sseConnected ? "LIVE" : null, badgeColor: "var(--cs-green)" },
      ],
    },
    {
      label: "Infrastructure",
      items: [
        { href: "/accounts",    label: "AWS Accounts",   icon: Server },
        { href: "/terminal",    label: "Cloud Shell",    icon: Terminal },
      ],
    },
    {
      label: "Administration",
      items: [
        { href: "/notifications", label: "Notifications",  icon: Bell },
        { href: "/audit",         label: "Audit Log",      icon: ShieldCheck },
        { href: "/setup",         label: "Setup Guide",    icon: HelpCircle },
      ],
    },
  ];

  const breadcrumbs: Record<string, string> = {
    "/": "Dashboard", "/aws": "Live Findings", "/alerts": "Alert Queue",
    "/analyze": "Analyzer", "/agents": "AI Agents", "/audit": "Audit Log",
    "/integrations": "Integrations", "/terminal": "Cloud Shell",
    "/accounts": "AWS Accounts", "/incidents": "Incidents",
    "/hunt": "Threat Hunt", "/mitre": "ATT&CK Matrix",
    "/fp-engine": "FP Engine", "/setup": "Setup Guide",
    "/notifications": "Notifications",
  };

  const currentLabel = location.startsWith("/alerts/")
    ? "Alert Queue"
    : breadcrumbs[location] ?? location.slice(1);

  const sidebarW = collapsed ? "48px" : "210px";

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--cs-bg)", color: "var(--cs-text)" }}>

      {/* ── Sidebar ── */}
      <aside
        className="flex-shrink-0 flex flex-col relative transition-all duration-200"
        style={{ width: sidebarW, background: "var(--aws-nav)", borderRight: "1px solid var(--cs-border)" }}
      >
        {/* Brand header */}
        <div
          className={cn("flex items-center py-3.5 transition-all", collapsed ? "justify-center px-0" : "gap-2.5 px-4")}
          style={{ borderBottom: "1px solid var(--cs-border)", background: "var(--cs-bg)" }}
        >
          <GuardAILogo collapsed={collapsed} />
          {!collapsed && (
            <div className="flex flex-col leading-none">
              <span className="font-bold text-[13px] tracking-wide" style={{ color: "var(--cs-orange)", fontFamily: "var(--app-font-sans)" }}>
                GuardAI
              </span>
              <span className="font-mono text-[9px] mt-0.5" style={{ color: "var(--cs-text-muted)" }}>
                GuardDuty Console · v2
              </span>
            </div>
          )}
        </div>

        {/* User row */}
        {user && !collapsed && (
          <div className="px-3 py-2.5 flex items-center gap-2.5" style={{ borderBottom: "1px solid var(--cs-border)", background: "var(--cs-surface)" }}>
            {user.imageUrl ? (
              <img src={user.imageUrl} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold" style={{ background: "var(--cs-orange)20", color: "var(--cs-orange)", border: "1px solid var(--cs-orange)40" }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium truncate" style={{ color: "var(--cs-text)" }}>{user.username}</div>
              <div className="text-[9px] truncate" style={{ color: "var(--cs-text-muted)" }}>{user.email}</div>
            </div>
          </div>
        )}
        {user && collapsed && (
          <div className="flex justify-center py-2" style={{ borderBottom: "1px solid var(--cs-border)" }}>
            {user.imageUrl ? (
              <img src={user.imageUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
            ) : (
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "var(--cs-orange)20", color: "var(--cs-orange)", border: "1px solid var(--cs-orange)40" }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-1">
          {navGroups.map(group => (
            <div key={group.label} className="mb-1">
              {!collapsed && (
                <div className="px-4 pt-4 pb-1 text-[9px] font-semibold tracking-[0.12em] uppercase" style={{ color: "var(--cs-text-muted)" }}>
                  {group.label}
                </div>
              )}
              {collapsed && <div className="pt-3 pb-0.5 mx-2" style={{ borderTop: "1px solid var(--cs-border)" }} />}
              {group.items.map(item => {
                const isActive = location === item.href || (item.href === "/alerts" && location.startsWith("/alerts/"));
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "relative flex items-center h-[34px] text-[12px] cursor-pointer group",
                        collapsed ? "justify-center px-0" : "gap-2.5 px-4"
                      )}
                      style={{
                        background: isActive ? "rgba(255,153,0,0.10)" : undefined,
                        color: isActive ? "var(--cs-text)" : "var(--cs-text-dim)",
                      }}
                      title={collapsed ? item.label : undefined}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      {isActive && <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-sm" style={{ background: "var(--cs-orange)" }} />}
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.badge != null && (
                        <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-sm" style={{
                          background: `${item.badgeColor ?? "var(--cs-orange)"}22`,
                          color: item.badgeColor ?? "var(--cs-orange)",
                          border: `1px solid ${item.badgeColor ?? "var(--cs-orange)"}44`,
                        }}>
                          {item.badge}
                        </span>
                      )}
                      {collapsed && item.badge != null && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: item.badgeColor ?? "var(--cs-orange)" }} />
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Status footer */}
        <div className="py-3 space-y-2" style={{ borderTop: "1px solid var(--cs-border)", background: "var(--cs-bg)", padding: collapsed ? "12px 0" : "12px 16px" }}>
          {!collapsed ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full", awsConnected ? "" : "")} style={{ background: awsConnected ? "var(--cs-green)" : "var(--cs-text-muted)" }} />
                  <span className="text-[10px] font-mono" style={{ color: awsConnected ? "var(--cs-green)" : "var(--cs-text-muted)" }}>
                    {awsConnected ? "AWS Connected" : "AWS Offline"}
                  </span>
                </div>
                {criticalAlerts > 0 && (
                  <span className="text-[9px] font-bold animate-pulse" style={{ color: "var(--cs-red)" }}>
                    {criticalAlerts} CRIT
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3" style={{ color: sseConnected ? "var(--cs-green)" : "var(--cs-text-muted)" }} />
                  <span className="text-[10px] font-mono" style={{ color: sseConnected ? "var(--cs-green)" : "var(--cs-text-muted)" }}>
                    {sseConnected ? "Stream Live" : "Stream Off"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Theme toggle */}
                  <button
                    onClick={toggleTheme}
                    className="flex items-center justify-center w-6 h-6 rounded-sm transition-colors"
                    style={{ background: "var(--cs-surface2)", border: "1px solid var(--cs-border)", color: "var(--cs-text-muted)" }}
                    title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  >
                    {theme === "dark"
                      ? <Sun className="w-3 h-3" />
                      : <Moon className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => logout()}
                    className="flex items-center gap-1 text-[10px] font-mono hover:opacity-100 transition-opacity opacity-50"
                    style={{ color: "var(--cs-text-muted)" }}
                    title="Sign out"
                  >
                    <LogOut className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: sseConnected ? "var(--cs-green)" : "var(--cs-text-muted)" }} title={sseConnected ? "Stream Live" : "Stream Off"} />
              {/* Theme toggle (collapsed) */}
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center w-6 h-6 rounded-sm transition-colors"
                style={{ background: "var(--cs-surface2)", border: "1px solid var(--cs-border)", color: "var(--cs-text-muted)" }}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark"
                  ? <Sun className="w-3 h-3" />
                  : <Moon className="w-3 h-3" />}
              </button>
              <button onClick={() => logout()} style={{ color: "var(--cs-text-muted)" }} title="Sign out">
                <LogOut className="w-3 h-3 opacity-50 hover:opacity-100" />
              </button>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-[56px] w-6 h-6 rounded-full flex items-center justify-center z-10 transition-colors"
          style={{ background: "var(--cs-surface2)", border: "1px solid var(--cs-border2)", color: "var(--cs-text-dim)" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0" style={{ background: "var(--cs-bg)" }}>

        {/* Top bar */}
        <div
          className="h-[44px] flex-shrink-0 flex items-center justify-between px-5 gap-3"
          style={{ background: "var(--cs-surface)", borderBottom: "1px solid var(--cs-border)" }}
        >
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[11px] flex-shrink-0" style={{ color: "var(--cs-text-dim)" }}>
            <span style={{ color: "var(--cs-orange)" }}>GuardAI</span>
            <span className="opacity-40">›</span>
            <span style={{ color: "var(--cs-text)" }}>{currentLabel}</span>
          </div>

          {/* Global Context Bar — Account + Timeframe */}
          <div className="flex items-center gap-2 flex-1 justify-center max-w-[460px]">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm" style={{ background: "var(--cs-surface2)", border: "1px solid var(--cs-border)" }}>
              <Filter className="w-3 h-3 flex-shrink-0" style={{ color: "var(--cs-text-muted)" }} />
              <select
                value={filters.accountId}
                onChange={e => setAccountId(e.target.value)}
                className="text-[11px] font-mono outline-none cursor-pointer bg-transparent appearance-none"
                style={{ color: "var(--cs-text-dim)" }}
              >
                <option value="all">All Accounts</option>
                <option value="prod">Production</option>
                <option value="dev">Development</option>
                <option value="staging">Staging</option>
              </select>
            </div>
            <div className="flex items-center rounded-sm overflow-hidden" style={{ border: "1px solid var(--cs-border)", background: "var(--cs-surface2)" }}>
              {(["1d","7d","30d","90d"] as Timeframe[]).map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className="px-2.5 py-1 text-[11px] font-mono transition-colors"
                  style={{
                    background: filters.timeframe === tf ? "var(--cs-orange)" : "transparent",
                    color: filters.timeframe === tf ? "#000" : "var(--cs-text-dim)",
                    fontWeight: filters.timeframe === tf ? 600 : 400,
                  }}
                >
                  {TIMEFRAME_LABELS[tf].replace("Last ", "")}
                </button>
              ))}
            </div>
            {activeAccountCount > 0 && (
              <div
                className="flex items-center gap-1 px-2 py-[3px] rounded-sm font-mono text-[10px]"
                style={{ background: "var(--cs-blue)15", border: "1px solid var(--cs-blue)40", color: "var(--cs-blue)" }}
                title={`${activeAccountCount} AWS account${activeAccountCount !== 1 ? "s" : ""} with alerts in this window`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cs-blue)", display: "inline-block" }} />
                {activeAccountCount} acct{activeAccountCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {sseConnected && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--cs-green)" }} />
                <span className="font-mono text-[9px]" style={{ color: "var(--cs-green)" }}>LIVE</span>
              </div>
            )}
            {pendingAlerts > 0 && (
              <Link href="/alerts">
                <span className="px-2 py-[2px] rounded-sm font-mono text-[10px] font-semibold cursor-pointer hover:opacity-80" style={{ background: "var(--cs-orange)20", border: "1px solid var(--cs-orange)50", color: "var(--cs-orange)" }}>
                  {pendingAlerts} pending
                </span>
              </Link>
            )}
            {criticalAlerts > 0 && (
              <Link href="/alerts">
                <span className="px-2 py-[2px] rounded-sm font-mono text-[10px] font-semibold cursor-pointer animate-pulse" style={{ background: "var(--cs-red)20", border: "1px solid var(--cs-red)50", color: "var(--cs-red)" }}>
                  {criticalAlerts} critical
                </span>
              </Link>
            )}

            {/* Notification bell */}
            <div className="relative" ref={notifPanelRef}>
              <button
                onClick={notifOpen ? () => setNotifOpen(false) : openNotifPanel}
                className="relative w-7 h-7 rounded-sm flex items-center justify-center transition-colors"
                style={{
                  background: notifOpen ? "var(--cs-orange)15" : "var(--cs-surface2)",
                  border: `1px solid ${notifOpen ? "var(--cs-orange)60" : "var(--cs-border)"}`,
                  color: notifOpen ? "var(--cs-orange)" : "var(--cs-text-dim)",
                }}
                title="Watched alert notifications"
              >
                <Bell className="w-3.5 h-3.5" />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full font-mono text-[8px] font-bold px-[3px]"
                    style={{ background: "var(--cs-orange)", color: "#000" }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div
                  className="absolute right-0 top-9 z-50 rounded-sm shadow-lg"
                  style={{
                    width: 340,
                    background: "var(--cs-surface)",
                    border: "1px solid var(--cs-border)",
                  }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid var(--cs-border)" }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--cs-text)" }}>WATCHED ALERTS</span>
                    <button onClick={() => setNotifOpen(false)} style={{ color: "var(--cs-text-muted)" }}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Events */}
                  <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
                    {notifEvents.length === 0 ? (
                      <div className="px-3 py-6 text-center">
                        <Bell className="w-5 h-5 mx-auto mb-2 opacity-30" style={{ color: "var(--cs-text-muted)" }} />
                        <p className="font-mono text-[11px]" style={{ color: "var(--cs-text-muted)" }}>No activity yet.</p>
                        <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--cs-text-muted)" }}>Watch alerts to get notified of changes.</p>
                      </div>
                    ) : (
                      notifEvents.map((event: AlertActivityEvent) => {
                        const isUnread = event.createdAt > lastCheckedAt;
                        const eventColors: Record<string, string> = {
                          status_change: "var(--cs-blue)",
                          note_added: "var(--cs-green)",
                          verdict_changed: "var(--cs-orange)",
                        };
                        const dotColor = eventColors[event.eventType] ?? "var(--cs-text-muted)";
                        return (
                          <Link key={event.id} href={`/alerts/${event.alertId}`}>
                            <div
                              className="flex gap-2.5 px-3 py-2.5 cursor-pointer transition-colors hover:opacity-80"
                              style={{
                                borderBottom: "1px solid var(--cs-border)",
                                background: isUnread ? "var(--cs-orange)08" : "transparent",
                              }}
                              onClick={() => setNotifOpen(false)}
                            >
                              <div className="mt-[5px] flex-shrink-0">
                                <div className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-1">
                                  <span className="font-mono text-[10px] font-semibold truncate" style={{ color: "var(--cs-text)" }}>
                                    {event.alertTitle || `Alert #${event.alertId}`}
                                  </span>
                                  {isUnread && (
                                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-[3px]" style={{ background: "var(--cs-orange)" }} />
                                  )}
                                </div>
                                <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--cs-text-dim)" }}>{event.description}</p>
                                <p className="font-mono text-[9px] mt-1" style={{ color: "var(--cs-text-muted)" }}>
                                  by {event.triggeredByName} · {new Date(event.createdAt).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="w-7 h-7 rounded-sm flex items-center justify-center transition-colors"
              style={{ background: "var(--cs-surface2)", border: "1px solid var(--cs-border)", color: "var(--cs-text-dim)" }}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark"
                ? <Moon className="w-3.5 h-3.5" />
                : <Sun className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6 w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

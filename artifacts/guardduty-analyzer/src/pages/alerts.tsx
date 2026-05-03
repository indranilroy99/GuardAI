import { useState, useEffect, useMemo } from "react";
import { useListAlerts, AlertSeverity, AlertRemediationStatus } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Filter, Search, Shield, Server, Activity, Clock, ShieldAlert } from "lucide-react";
import { clsx } from "clsx";
import { format } from "date-fns";
import { useGlobalFilters, type Timeframe } from "@/lib/global-filters-context";

function timeframeToSince(tf: Timeframe): string {
  const days = ({ "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as Record<Timeframe, number>)[tf];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type FpPattern = { type: string; mitreAttackTechniqueId: string; confidence: number };


export function Alerts() {
  const { filters } = useGlobalFilters();
  const [fpPatterns, setFpPatterns] = useState<FpPattern[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  // Fetch FP patterns once to power "Likely FP" badges
  useEffect(() => {
    fetch(`${BASE_URL}/api/fp-engine/patterns`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { patterns: FpPattern[] }) => setFpPatterns(d.patterns ?? []))
      .catch(() => {});
  }, []);

  // Build a lookup set: "type::techniqueId" → confidence
  const fpLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of fpPatterns) map.set(`${p.type}::${p.mitreAttackTechniqueId}`, p.confidence);
    return map;
  }, [fpPatterns]);

  const { data: alerts, isLoading, isError } = useListAlerts({
    ...(severityFilter ? { severity: severityFilter as any } : {}),
    ...(statusFilter ? { status: statusFilter as any } : {}),
    ...(filters.accountId !== "all" ? { accountId: filters.accountId } : {}),
    since: timeframeToSince(filters.timeframe),
  });

  const severityColors = {
    [AlertSeverity.CRITICAL]: "text-red-500 bg-red-500/10 border-red-500/20",
    [AlertSeverity.HIGH]: "text-orange-500 bg-orange-500/10 border-orange-500/20",
    [AlertSeverity.MEDIUM]: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
    [AlertSeverity.LOW]: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  };

  const statusColors = {
    [AlertRemediationStatus.pending]: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
    [AlertRemediationStatus.generated]: "text-blue-500 bg-blue-500/10 border-blue-500/20",
    [AlertRemediationStatus.applied]: "text-green-500 bg-green-500/10 border-green-500/20",
    [AlertRemediationStatus.failed]: "text-red-500 bg-red-500/10 border-red-500/20",
  };

  const filteredAlerts = alerts?.filter(a => 
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || 
    a.affectedResource.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Active Alerts</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">Manage and remediate identified threats.</p>
        </div>
        <Link href="/analyze">
          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium text-sm hover:bg-primary/90 transition-colors">
            Analyze New Alert
          </button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 bg-card border border-border p-4 rounded-lg">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search alerts or resources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background border border-input rounded-md py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        
        <div className="flex gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-background border border-input rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono cursor-pointer"
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border border-input rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="pending">pending</option>
            <option value="generated">generated</option>
            <option value="applied">applied</option>
            <option value="failed">failed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="p-4 flex gap-4 animate-pulse">
                <div className="w-16 h-6 bg-secondary rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-secondary rounded w-1/3" />
                  <div className="h-4 bg-secondary rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-destructive">Failed to load alerts.</div>
        ) : filteredAlerts?.length === 0 ? (
          <div className="p-16 text-center text-muted-foreground flex flex-col items-center">
            <ShieldAlert className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <div className="text-lg font-medium text-foreground">No alerts found</div>
            <p className="mt-1">Try adjusting your filters or analyze a new alert.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 border-b border-border font-mono tracking-wider">
                <tr>
                  <th className="px-6 py-3">Severity</th>
                  <th className="px-6 py-3">Alert Info</th>
                  <th className="px-6 py-3">Resource</th>
                  <th className="px-6 py-3">MITRE Tactic</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {filteredAlerts?.map((alert) => {
                    const fpKey = `${alert.type}::${(alert as any).mitreAttackTechniqueId ?? ""}`;
                    const fpConf = fpLookup.get(fpKey);
                    const isLikelyFp = (alert as any).verdict !== "FALSE_POSITIVE" && fpConf !== undefined;
                    return (
                  <tr key={alert.id} className="hover:bg-secondary/30 transition-colors group cursor-pointer" onClick={() => window.location.href = `/alerts/${alert.id}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        "px-2.5 py-1 rounded text-xs font-bold border uppercase",
                        severityColors[alert.severity as keyof typeof severityColors]
                      )}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="font-sans font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1 max-w-[260px]" title={alert.title}>
                          {alert.title}
                        </div>
                        {isLikelyFp && (
                          <span className="flex-shrink-0 font-mono text-[8px] font-bold px-1.5 py-[2px] bg-[#f59e0b15] border border-[#f59e0b40] text-[#f59e0b] rounded-[2px] tracking-wider">
                            LIKELY FP {fpConf}%
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate max-w-[300px]">
                        {alert.type}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-foreground">{alert.affectedResource}</div>
                      <div className="text-xs text-muted-foreground mt-1">{alert.resourceType}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="bg-secondary text-foreground px-2 py-1 rounded-md text-xs border border-border">
                        {alert.mitreAttackTactic}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        "flex items-center text-xs font-medium",
                        statusColors[alert.remediationStatus as keyof typeof statusColors] ? statusColors[alert.remediationStatus as keyof typeof statusColors].split(' ')[0] : "text-muted-foreground"
                      )}>
                        <span className={clsx("w-1.5 h-1.5 rounded-full mr-1.5", statusColors[alert.remediationStatus as keyof typeof statusColors] ? statusColors[alert.remediationStatus as keyof typeof statusColors].split(' ')[1] : "bg-muted")} />
                        {alert.remediationStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-muted-foreground text-xs">
                      {format(new Date(alert.createdAt), "MMM d, HH:mm")}
                    </td>
                  </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

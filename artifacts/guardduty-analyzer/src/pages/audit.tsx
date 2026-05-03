import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Shield, Download, FileText } from "lucide-react";

interface AuditEntry {
  id: number;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  severity: string;
  createdAt: string;
}

const SEV_COLOR: Record<string, string> = {
  INFO: "#60a5fa",
  WARN: "#fbbf24",
  ERROR: "#f14c4c",
};

export function AuditLog() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("");

  function loadLogs() {
    setIsLoading(true);
    setIsError(false);
    const url = new URL("/api/audit", window.location.origin);
    url.searchParams.set("limit", "500");
    if (sevFilter) url.searchParams.set("severity", sevFilter);

    fetch(url.toString())
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        setLogs(Array.isArray(data) ? (data as AuditEntry[]) : []);
        setIsLoading(false);
      })
      .catch(() => {
        setIsError(true);
        setIsLoading(false);
      });
  }

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sevFilter]);

  const filtered = logs.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      (l.ipAddress || "").includes(q) ||
      (l.resourceType || "").toLowerCase().includes(q) ||
      (l.resourceId || "").toLowerCase().includes(q)
    );
  });

  function exportPdf() {
    const now = format(new Date(), "yyyy-MM-dd HH:mm");
    const rows = filtered.map(l => {
      let details: { statusCode?: number; durationMs?: number } = {};
      try { details = JSON.parse(l.details || "{}"); } catch {}
      return `
        <tr>
          <td>${format(new Date(l.createdAt), "MM-dd HH:mm:ss")}</td>
          <td style="color:${SEV_COLOR[l.severity]??'#7f9ab0'}">${l.severity}</td>
          <td>${l.action}</td>
          <td>${l.resourceType ? `${l.resourceType}/${l.resourceId ?? ""}` : "—"}</td>
          <td>${l.ipAddress ?? "—"}</td>
          <td>${details.statusCode != null ? `HTTP ${details.statusCode}` : "—"}${details.durationMs != null ? ` · ${details.durationMs}ms` : ""}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <title>GuardAI Audit Log — ${now}</title>
      <style>
        body{font-family:'Courier New',monospace;font-size:11px;color:#0f172a;margin:24px;background:#fff}
        h1{font-size:16px;font-weight:700;margin-bottom:4px}
        .meta{font-size:10px;color:#64748b;margin-bottom:16px}
        table{width:100%;border-collapse:collapse}
        th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#64748b;padding:6px 8px;border-bottom:2px solid #e2e8f0}
        td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10px;color:#0f172a;word-break:break-all}
        tr:nth-child(even) td{background:#f8fafc}
        .footer{margin-top:24px;font-size:9px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px}
      </style>
    </head><body>
      <h1>GuardAI — Audit Log Report</h1>
      <div class="meta">Generated: ${now} · Total entries: ${filtered.length}</div>
      <table>
        <thead><tr><th>Time</th><th>Level</th><th>Action</th><th>Resource</th><th>IP</th><th>Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">All API write operations are logged. Sensitive fields are automatically redacted before storage. Log entries are immutable once written.</div>
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  }

  function exportCsv() {
    const headers = ["Time", "Level", "Action", "Resource", "IP", "Status", "Duration"];
    const rows = filtered.map(l => {
      let details: { statusCode?: number; durationMs?: number } = {};
      try { details = JSON.parse(l.details || "{}"); } catch {}
      return [
        format(new Date(l.createdAt), "yyyy-MM-dd HH:mm:ss"),
        l.severity,
        l.action,
        l.resourceType ? `${l.resourceType}/${l.resourceId || ""}` : "-",
        l.ipAddress || "-",
        details.statusCode ?? "-",
        details.durationMs ? `${details.durationMs}ms` : "-",
      ].join(",");
    });
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `guardai-audit-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--cs-text)]">AUDIT LOG</h1>
          <p className="text-[11px] font-mono text-[var(--cs-text-muted)] mt-1">
            Tamper-evident trail of all API mutations. Sensitive fields are automatically redacted.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search actions, IPs, resources…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[12px] font-mono text-[var(--cs-text)] px-3 py-1.5 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)] placeholder:text-[var(--cs-border2)] w-56"
          />
          <select
            value={sevFilter}
            onChange={e => setSevFilter(e.target.value)}
            className="bg-[var(--cs-surface)] border border-[var(--cs-border)] text-[12px] font-mono text-[var(--cs-text)] px-3 py-1.5 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)]"
          >
            <option value="">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--cs-border)] bg-[var(--cs-surface)] text-[var(--cs-text-dim)] font-mono text-[11px] rounded-[3px] hover:text-[var(--cs-text)] hover:border-[var(--cs-text-muted)] transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            onClick={exportPdf}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--cs-border)] bg-[var(--cs-surface)] text-[var(--cs-text-dim)] font-mono text-[11px] rounded-[3px] hover:text-[var(--cs-text)] hover:border-[var(--cs-text-muted)] transition-colors disabled:opacity-40"
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>

      <div className="h-[1px] w-full bg-[var(--cs-border)]" />

      {/* Summary bar */}
      <div className="flex items-center gap-6 text-[11px] font-mono text-[var(--cs-text-muted)]">
        <span>TOTAL: <span className="text-[var(--cs-text)]">{filtered.length}</span></span>
        <span>INFO: <span className="text-[#60a5fa]">{filtered.filter(l => l.severity === "INFO").length}</span></span>
        <span>WARN: <span className="text-[#fbbf24]">{filtered.filter(l => l.severity === "WARN").length}</span></span>
        <span>ERROR: <span className="text-[#f14c4c]">{filtered.filter(l => l.severity === "ERROR").length}</span></span>
      </div>

      {/* Table */}
      <div className="border border-[var(--cs-border)] rounded-[3px] bg-[var(--cs-surface)] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[var(--cs-surface2)] border-b border-[var(--cs-border)]">
            <tr>
              <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.15em] text-[var(--cs-text-muted)]">TIME</th>
              <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.15em] text-[var(--cs-text-muted)]">LEVEL</th>
              <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.15em] text-[var(--cs-text-muted)]">ACTION</th>
              <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.15em] text-[var(--cs-text-muted)]">RESOURCE</th>
              <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.15em] text-[var(--cs-text-muted)]">IP ADDRESS</th>
              <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.15em] text-[var(--cs-text-muted)]">RESULT</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--cs-surface)]">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-3 bg-[var(--cs-surface2)] rounded animate-pulse w-full" style={{ opacity: 1 - i * 0.08 }} />
                  </td>
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center font-mono text-[12px] text-[#f14c4c]">
                  FAILED TO LOAD AUDIT LOG
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-[var(--cs-text-muted)]">
                    <Shield className="w-8 h-8 opacity-20" />
                    <span className="font-mono text-[12px]">NO AUDIT ENTRIES</span>
                    <span className="font-mono text-[10px]">Entries appear as soon as API mutations occur</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(log => {
                const color = SEV_COLOR[log.severity] || "var(--cs-text-dim)";
                let details: { statusCode?: number; durationMs?: number } = {};
                try { details = JSON.parse(log.details || "{}"); } catch {}
                const isWarn = details.statusCode != null && details.statusCode >= 400;
                return (
                  <tr key={log.id} className="border-b border-[var(--cs-surface)] last:border-0 hover:bg-[var(--cs-surface2)] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--cs-text-dim)] whitespace-nowrap">
                      {format(new Date(log.createdAt), "MM-dd HH:mm:ss")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="px-1.5 py-[1px] rounded-[2px] font-mono text-[9px] font-bold uppercase"
                        style={{ color, backgroundColor: color + "20", border: `1px solid ${color}40` }}
                      >
                        {log.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--cs-text)]">{log.action}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--cs-text-dim)]">
                      {log.resourceType && log.resourceId
                        ? `${log.resourceType}/${log.resourceId}`
                        : (log.resourceType || "—")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--cs-text-dim)]">
                      {log.ipAddress || "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: isWarn ? "#fbbf24" : "var(--cs-text-muted)" }}>
                      {details.statusCode != null ? `HTTP ${details.statusCode}` : "—"}
                      {details.durationMs != null ? ` · ${details.durationMs}ms` : ""}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2 text-[10px] font-mono text-[var(--cs-border2)]">
        <Shield className="w-3 h-3 text-[#ff990030] flex-shrink-0 mt-0.5" />
        <span>
          All API write operations are logged. AWS credentials, API keys, and session tokens are automatically redacted before storage.
          Log entries are immutable once written.
        </span>
      </div>
    </div>
  );
}

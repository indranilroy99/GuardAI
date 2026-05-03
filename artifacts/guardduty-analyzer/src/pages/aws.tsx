import { useState, useEffect } from "react";
import { useTestAwsConnection, useFetchAwsFindings, useImportAndAnalyzeFinding } from "@workspace/api-client-react";
import type { LiveFinding, AwsCredentials } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListAlertsQueryKey, getGetAlertStatsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Loader2, Check, RefreshCw, Unplug } from "lucide-react";

const CREDS_KEY = "guardaiAwsCreds";

const REGIONS = [
  "us-east-1","us-east-2","us-west-1","us-west-2",
  "eu-west-1","eu-west-2","eu-west-3","eu-central-1",
  "ap-northeast-1","ap-northeast-2","ap-southeast-1","ap-southeast-2",
  "ca-central-1","sa-east-1","ap-south-1",
];

function severityFromScore(score: number) {
  if (score >= 9) return { label: "CRITICAL", bg: "#ff1a1a18", border: "#ff1a1a40", text: "#f14c4c" };
  if (score >= 7) return { label: "HIGH", bg: "#ff6b0018", border: "#ff6b0040", text: "#ff8533" };
  if (score >= 4) return { label: "MEDIUM", bg: "#f59e0b18", border: "#f59e0b40", text: "#fbbf24" };
  return { label: "LOW", bg: "#3b82f618", border: "#3b82f640", text: "#60a5fa" };
}

export function AwsConnect() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [creds, setCreds] = useState<AwsCredentials>({
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    region: "us-east-1",
  });

  const [connectionInfo, setConnectionInfo] = useState<{
    accountId?: string;
    arn?: string;
    detectorId?: string;
    guardDutyEnabled?: boolean;
  } | null>(null);

  const [findings, setFindings] = useState<LiveFinding[]>([]);
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set(["CRITICAL","HIGH","MEDIUM","LOW"]));
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);

  const testConnection = useTestAwsConnection();
  const fetchFindings = useFetchAwsFindings();
  const importFinding = useImportAndAnalyzeFinding();

  useEffect(() => {
    const stored = localStorage.getItem(CREDS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AwsCredentials;
        setCreds(parsed);
        setConnectionInfo({ guardDutyEnabled: true });
        doFetchFindings(parsed);
      } catch {}
    }
  }, []);

  function doFetchFindings(c: AwsCredentials) {
    fetchFindings.mutate(
      { data: { credentials: c, maxResults: 50 } },
      {
        onSuccess: (data) => {
          setFindings(data);
          const alreadyImported = new Set(
            data.filter(f => f.alreadyImported).map(f => f.id)
          );
          setImportedIds(alreadyImported);
        },
        onError: (err: any) => {
          toast({ title: "Failed to fetch findings", description: err?.message, variant: "destructive" });
        },
      }
    );
  }

  function handleConnect() {
    if (!creds.accessKeyId || !creds.secretAccessKey || !creds.region) {
      toast({ title: "All fields required", variant: "destructive" });
      return;
    }
    testConnection.mutate(
      { data: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken || undefined, region: creds.region } },
      {
        onSuccess: (result) => {
          if (result.success) {
            setConnectionInfo(result);
            localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
            toast({ title: "Connection established", description: `Account: ${result.accountId}` });
            doFetchFindings(creds);
          } else {
            toast({ title: "Connection failed", description: result.error || "Invalid credentials", variant: "destructive" });
          }
        },
        onError: (err: any) => {
          toast({ title: "Connection error", description: err?.message, variant: "destructive" });
        },
      }
    );
  }

  function handleDisconnect() {
    localStorage.removeItem(CREDS_KEY);
    setConnectionInfo(null);
    setFindings([]);
    setImportedIds(new Set());
    setCreds({ accessKeyId: "", secretAccessKey: "", sessionToken: "", region: "us-east-1" });
    toast({ title: "Disconnected" });
  }

  function handleImport(finding: LiveFinding) {
    setImportingId(finding.id);
    importFinding.mutate(
      { data: { credentials: creds, findingRawJson: finding.rawJson } },
      {
        onSuccess: () => {
          setImportedIds(prev => new Set([...prev, finding.id]));
          setImportingId(null);
          queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey() });
          toast({ title: "Finding imported & analyzed" });
        },
        onError: (err: any) => {
          setImportingId(null);
          toast({ title: "Import failed", description: err?.message, variant: "destructive" });
        },
      }
    );
  }

  function handleImportAll() {
    const unimported = filteredFindings.filter(f => !importedIds.has(f.id));
    if (unimported.length === 0) {
      toast({ title: "All findings already imported" });
      return;
    }
    let done = 0;
    unimported.forEach(f => {
      importFinding.mutate(
        { data: { credentials: creds, findingRawJson: f.rawJson } },
        {
          onSuccess: () => {
            setImportedIds(prev => new Set([...prev, f.id]));
            done++;
            if (done === unimported.length) {
              queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
              queryClient.invalidateQueries({ queryKey: getGetAlertStatsQueryKey() });
              toast({ title: `${done} findings imported` });
            }
          },
        }
      );
    });
  }

  function toggleSeverity(sev: string) {
    setSeverityFilter(prev => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }

  const filteredFindings = findings.filter(f => {
    const { label } = severityFromScore(f.severity);
    return severityFilter.has(label);
  });

  const isConnected = !!connectionInfo;

  if (!isConnected) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-[#e8eaf0]">AWS CONNECT</h1>
        </div>
        <div className="h-[1px] w-full bg-[#1f2f40] mb-8" />

        <div className="grid grid-cols-2 gap-8 max-w-5xl">
          {/* Credential Form */}
          <div className="space-y-5">
            <div className="text-[11px] font-mono uppercase tracking-widest text-[#7f9ab0] mb-4">CREDENTIALS</div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-widest text-[#7f9ab0] font-mono">Region</label>
              <select
                value={creds.region}
                onChange={e => setCreds(p => ({ ...p, region: e.target.value }))}
                className="w-full bg-[#08111a] border border-[#1f2f40] text-[13px] font-mono text-[#e8eaf0] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[#ff9900] transition-colors"
              >
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-widest text-[#7f9ab0] font-mono">Access Key ID</label>
              <input
                type="text"
                value={creds.accessKeyId}
                onChange={e => setCreds(p => ({ ...p, accessKeyId: e.target.value }))}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="w-full bg-[#08111a] border border-[#1f2f40] text-[13px] font-mono text-[#e8eaf0] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[#ff9900] transition-colors placeholder:text-[#415161]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-widest text-[#7f9ab0] font-mono">Secret Access Key</label>
              <input
                type="password"
                value={creds.secretAccessKey}
                onChange={e => setCreds(p => ({ ...p, secretAccessKey: e.target.value }))}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className="w-full bg-[#08111a] border border-[#1f2f40] text-[13px] font-mono text-[#e8eaf0] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[#ff9900] transition-colors placeholder:text-[#415161]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-widest text-[#7f9ab0] font-mono">Session Token <span className="text-[#415161]">(optional)</span></label>
              <input
                type="password"
                value={creds.sessionToken || ""}
                onChange={e => setCreds(p => ({ ...p, sessionToken: e.target.value }))}
                placeholder="For temporary credentials only"
                className="w-full bg-[#08111a] border border-[#1f2f40] text-[13px] font-mono text-[#e8eaf0] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[#ff9900] transition-colors placeholder:text-[#415161]"
              />
            </div>

            <div className="pt-2">
              <p className="text-[11px] text-[#415161] font-mono mb-4">
                Credentials are stored in your browser session only. Required permissions: guardduty:ListDetectors, guardduty:ListFindings, guardduty:GetFindings, sts:GetCallerIdentity
              </p>
              <button
                onClick={handleConnect}
                disabled={testConnection.isPending}
                className="w-full py-2.5 px-4 border border-[#ff990040] bg-[#ff990018] text-[#ff9900] font-mono text-[12px] uppercase tracking-widest rounded-[3px] hover:bg-[#ff990030] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {testConnection.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> CONNECTING...</> : "ESTABLISH CONNECTION"}
              </button>
            </div>
          </div>

          {/* Connection Diagram */}
          <div className="flex flex-col items-center justify-center space-y-3 text-[12px] font-mono select-none">
            <div className="text-[10px] uppercase tracking-widest text-[#415161] mb-2">CONNECTION PATH</div>
            <div className="px-4 py-2.5 border border-[#1f2f40] bg-[#141f2e] rounded-[3px] text-[#7f9ab0] text-center w-48">
              BROWSER CLIENT
            </div>
            <div className="flex flex-col items-center text-[#415161] space-y-0.5">
              <div>│</div><div>│ HTTPS</div><div>▼</div>
            </div>
            <div className="px-4 py-2.5 border border-[#ff990040] bg-[#ff99000a] rounded-[3px] text-[#ff9900] text-center w-48">
              GUARD AI API
            </div>
            <div className="flex flex-col items-center text-[#415161] space-y-0.5">
              <div>│</div><div>│ AWS SDK</div><div>▼</div>
            </div>
            <div className="px-4 py-2.5 border border-[#ff8533]/30 bg-[#ff6b0010] rounded-[3px] text-[#ff8533] text-center w-48">
              AWS GUARDDUTY
            </div>
            <div className="mt-4 text-[#415161] text-[11px] text-center">
              Status: <span className="text-[#f14c4c]">NOT CONNECTED</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-[#e8eaf0]">LIVE FINDINGS</h1>
          <span className="px-2 py-[2px] bg-[#ff990018] border border-[#ff990040] rounded-[2px] text-[#ff9900] font-mono text-[11px]">
            ACCT: {connectionInfo.accountId || "—"}
          </span>
          <span className="px-2 py-[2px] bg-[#1a2535] border border-[#1f2f40] rounded-[2px] text-[#7f9ab0] font-mono text-[11px]">
            {creds.region}
          </span>
          {connectionInfo.guardDutyEnabled && (
            <span className="px-2 py-[2px] bg-[#1db95418] border border-[#1db95440] rounded-[2px] text-[#1db954] font-mono text-[11px]">
              GUARDDUTY ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => doFetchFindings(creds)}
            disabled={fetchFindings.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1f2f40] bg-[#141f2e] text-[#7f9ab0] font-mono text-[11px] uppercase tracking-wide rounded-[3px] hover:text-[#e8eaf0] hover:border-[#415161] transition-colors"
          >
            {fetchFindings.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            REFRESH
          </button>
          <button
            onClick={handleImportAll}
            disabled={importFinding.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#ff990040] bg-[#ff990018] text-[#ff9900] font-mono text-[11px] uppercase tracking-wide rounded-[3px] hover:bg-[#ff990030] transition-colors"
          >
            SYNC ALL
          </button>
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#ff1a1a40] bg-[#ff1a1a0a] text-[#f14c4c] font-mono text-[11px] uppercase tracking-wide rounded-[3px] hover:bg-[#ff1a1a18] transition-colors"
          >
            <Unplug className="w-3 h-3" />
            DISCONNECT
          </button>
        </div>
      </div>

      <div className="h-[1px] w-full bg-[#1f2f40] mb-4" />

      {/* Severity Filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-mono text-[#415161] uppercase tracking-widest mr-1">FILTER:</span>
        {(["CRITICAL","HIGH","MEDIUM","LOW"] as const).map(sev => {
          const s = severityFromScore(sev === "CRITICAL" ? 10 : sev === "HIGH" ? 8 : sev === "MEDIUM" ? 5 : 2);
          const active = severityFilter.has(sev);
          return (
            <button
              key={sev}
              onClick={() => toggleSeverity(sev)}
              className="px-3 py-[3px] rounded-[2px] font-mono text-[11px] font-semibold uppercase border transition-colors"
              style={{
                backgroundColor: active ? s.bg : "transparent",
                borderColor: active ? s.border : "#1f2f40",
                color: active ? s.text : "#415161",
              }}
            >
              {sev}
            </button>
          );
        })}
        <span className="ml-auto text-[11px] font-mono text-[#415161]">{filteredFindings.length} FINDINGS</span>
      </div>

      {/* Findings Table */}
      <div className="border border-[#1f2f40] rounded-[3px] bg-[#141f2e] overflow-hidden">
        {fetchFindings.isPending ? (
          <div className="flex items-center justify-center py-16 text-[#415161] font-mono text-[12px]">
            <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#ff9900]" />
            FETCHING FROM AWS...
          </div>
        ) : filteredFindings.length === 0 ? (
          <div className="py-16 text-center font-mono text-[12px] text-[#415161]">
            NO FINDINGS MATCH CURRENT FILTERS
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#141f2e] border-b border-[#1f2f40]">
              <tr>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0]">SEV</th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0]">ID</th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0]">FINDING TYPE</th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0]">RESOURCE</th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0]">REGION</th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0]">TIME</th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[#7f9ab0] text-right">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredFindings.map(f => {
                const s = severityFromScore(f.severity);
                const isImported = importedIds.has(f.id);
                const isImporting = importingId === f.id;
                return (
                  <tr key={f.id} className="border-b border-[#141824] last:border-0 hover:bg-[#1a2535] transition-colors">
                    <td className="px-4 py-3">
                      <span className="px-2 py-[2px] rounded-[2px] font-mono text-[11px] font-semibold uppercase border"
                        style={{ backgroundColor: s.bg, borderColor: s.border, color: s.text }}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#7f9ab0]" title={f.id}>
                      {f.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#e8eaf0] max-w-[240px] truncate" title={f.type}>
                      {f.type}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#7f9ab0] max-w-[160px] truncate" title={f.affectedResource}>
                      {f.affectedResource}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#7f9ab0]">{f.region}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#7f9ab0]">
                      {new Date(f.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isImported ? (
                        <span className="flex items-center justify-end gap-1 text-[#1db954] font-mono text-[11px]">
                          <Check className="w-3 h-3" /> IMPORTED
                        </span>
                      ) : (
                        <button
                          onClick={() => handleImport(f)}
                          disabled={isImporting}
                          className="px-3 py-[3px] border border-[#ff990040] bg-[#ff990018] text-[#ff9900] font-mono text-[11px] uppercase rounded-[2px] hover:bg-[#ff990030] transition-colors disabled:opacity-50 flex items-center gap-1 ml-auto"
                        >
                          {isImporting ? <><Loader2 className="w-3 h-3 animate-spin" /> ANALYZING</> : "IMPORT"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

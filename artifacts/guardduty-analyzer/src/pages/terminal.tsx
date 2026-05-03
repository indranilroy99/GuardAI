/**
 * AWS Cloud Shell Terminal
 *
 * In-browser AWS CLI that executes real SDK calls via the API server.
 * Credentials live only in sessionStorage — never stored server-side.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal as TerminalIcon, Key, ChevronRight, Trash2, Copy, Check,
  Wifi, WifiOff, Loader2, Shield, BookOpen, Eye, EyeOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const CREDS_KEY = "sentinelAwsTerminalCreds";

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
  profileName: string;
}

interface OutputLine {
  id: string;
  kind: "input" | "output" | "error" | "info" | "help";
  content: string;
  ts: number;
}

const QUICK_COMMANDS = [
  { label: "Caller Identity", cmd: "aws sts get-caller-identity" },
  { label: "GuardDuty Detectors", cmd: "aws guardduty list-detectors" },
  { label: "IAM Users", cmd: "aws iam list-users" },
  { label: "IAM Roles", cmd: "aws iam list-roles" },
  { label: "EC2 Instances", cmd: "aws ec2 describe-instances" },
  { label: "Security Groups", cmd: "aws ec2 describe-security-groups" },
  { label: "S3 Buckets", cmd: "aws s3 ls" },
  { label: "Lambda Functions", cmd: "aws lambda list-functions" },
  { label: "CloudTrail Events", cmd: "aws cloudtrail lookup-events --max-results 10" },
  { label: "Log Groups", cmd: "aws logs describe-log-groups" },
  { label: "RDS Instances", cmd: "aws rds describe-db-instances" },
  { label: "EKS Clusters", cmd: "aws eks list-clusters" },
  { label: "Account Summary", cmd: "aws iam get-account-summary" },
  { label: "Password Policy", cmd: "aws iam get-account-password-policy" },
  { label: "VPCs", cmd: "aws ec2 describe-vpcs" },
  { label: "EBS Volumes", cmd: "aws ec2 describe-volumes" },
];

function formatOutput(obj: unknown, indent = 2): string {
  if (typeof obj === "string") return obj;
  return JSON.stringify(obj, null, indent);
}

export function TerminalPage() {
  const [creds, setCreds] = useState<AwsCredentials>(() => {
    try {
      const stored = sessionStorage.getItem(CREDS_KEY);
      return stored ? JSON.parse(stored) as AwsCredentials : {
        accessKeyId: "", secretAccessKey: "", sessionToken: "", region: "us-east-1", profileName: "default",
      };
    } catch { return { accessKeyId: "", secretAccessKey: "", sessionToken: "", region: "us-east-1", profileName: "default" }; }
  });
  const [showSecret, setShowSecret] = useState(false);
  const [credsConnected, setCredsConnected] = useState(false);
  const [credsLoading, setCredsLoading] = useState(false);
  const [lines, setLines] = useState<OutputLine[]>([
    { id: "welcome", kind: "info", content: `GUARD AI · AWS Cloud Shell\nType "help" for available commands or use the Quick Commands panel.\nCredentials are stored only in your browser session — never on our servers.`, ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [copied, setCopied] = useState<string | null>(null);
  const [showCreds, setShowCreds] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Persist creds to sessionStorage (not localStorage)
  useEffect(() => {
    sessionStorage.setItem(CREDS_KEY, JSON.stringify(creds));
  }, [creds]);

  const addLine = useCallback((kind: OutputLine["kind"], content: string) => {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), kind, content, ts: Date.now() }]);
  }, []);

  const testConnection = useCallback(async () => {
    if (!creds.accessKeyId || !creds.secretAccessKey) {
      toast({ title: "Enter credentials first", variant: "destructive" });
      return;
    }
    setCredsLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/terminal/exec`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "aws sts get-caller-identity",
          credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken || undefined, region: creds.region },
        }),
      });
      if (r.ok) {
        const data = await r.json() as { output: unknown };
        setCredsConnected(true);
        setShowCreds(false);
        addLine("info", `✓ Connected as ${JSON.stringify(data.output)}`);
        toast({ title: "AWS Connected", description: "Credentials verified successfully" });
      } else {
        const err = await r.json() as { error: string };
        setCredsConnected(false);
        toast({ title: "Connection failed", description: err.error, variant: "destructive" });
      }
    } catch {
      setCredsConnected(false);
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setCredsLoading(false);
    }
  }, [creds, addLine, toast]);

  const execCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    addLine("input", trimmed);
    setHistory((h) => [trimmed, ...h.slice(0, 99)]);
    setHistoryIdx(-1);
    setInput("");

    if (trimmed === "clear") {
      setLines([{ id: crypto.randomUUID(), kind: "info", content: "Terminal cleared.", ts: Date.now() }]);
      return;
    }
    if (trimmed === "help") {
      setLoading(true);
      try {
        const r = await fetch(`${BASE_URL}/api/terminal/exec`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "help", credentials: { accessKeyId: "x", secretAccessKey: "x", region: creds.region } }),
        });
        const data = await r.json() as { output: string };
        addLine("help", data.output);
      } finally { setLoading(false); }
      return;
    }

    if (!creds.accessKeyId || !creds.secretAccessKey) {
      addLine("error", "Error: No AWS credentials configured. Set your credentials in the panel above.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/terminal/exec`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: trimmed,
          credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken || undefined,
            region: creds.region,
          },
        }),
      });
      const data = await r.json() as { output?: unknown; error?: string };
      if (r.ok && data.output !== undefined) {
        addLine("output", formatOutput(data.output));
      } else {
        addLine("error", `Error: ${data.error ?? "Unknown error"}`);
      }
    } catch (err) {
      addLine("error", `Network error: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [creds, addLine]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void execCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next);
      setInput(next === -1 ? "" : (history[next] ?? ""));
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Simple autocomplete for service names
      const parts = input.split(" ");
      if (parts[0] === "aws" && parts.length === 2) {
        const services = ["sts", "guardduty", "ec2", "iam", "cloudtrail", "s3", "s3api", "lambda", "logs", "rds", "eks"];
        const match = services.find((s) => s.startsWith(parts[1] ?? ""));
        if (match) setInput(`aws ${match} `);
      }
    }
  };

  const copyLine = (content: string) => {
    void navigator.clipboard.writeText(content);
    setCopied(content.slice(0, 20));
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="flex flex-col h-full gap-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono font-bold text-[20px] tracking-tight text-[#e8eaf0]">AWS CLOUD SHELL</h1>
          <p className="font-mono text-[10px] text-[#415161] tracking-[0.1em] mt-0.5">Execute AWS SDK commands from your browser — credentials stored locally only</p>
        </div>
        <div className="flex items-center gap-2">
          {credsConnected
            ? <><Wifi className="w-3.5 h-3.5 text-[#1db954]" /><span className="font-mono text-[10px] text-[#1db954]">CONNECTED · {creds.region}</span></>
            : <><WifiOff className="w-3.5 h-3.5 text-[#415161]" /><span className="font-mono text-[10px] text-[#415161]">NOT CONNECTED</span></>
          }
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left panel — credentials + quick commands */}
        <div className="w-[260px] flex-shrink-0 flex flex-col gap-3">
          {/* Credentials panel */}
          <div className="bg-[#141f2e] border border-[#1f2f40] rounded-[3px] overflow-hidden">
            <button
              onClick={() => setShowCreds((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 border-b border-[#1f2f40] hover:bg-[#1a2535] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-[#ff9900]" />
                <span className="font-mono text-[11px] font-bold text-[#e8eaf0] tracking-wider">CREDENTIALS</span>
              </div>
              <div className={`w-1.5 h-1.5 rounded-full ${credsConnected ? "bg-[#1db954]" : "bg-[#415161]"}`} />
            </button>

            {showCreds && (
              <div className="p-3 space-y-2">
                <div>
                  <label className="font-mono text-[8px] text-[#415161] tracking-[0.15em] uppercase">Profile Name</label>
                  <input
                    className="w-full mt-1 px-2 py-1.5 bg-[#0f1923] border border-[#1f2f40] rounded-[2px] font-mono text-[11px] text-[#e8eaf0] focus:border-[#ff9900] outline-none"
                    value={creds.profileName}
                    onChange={(e) => setCreds((c) => ({ ...c, profileName: e.target.value }))}
                    placeholder="default"
                  />
                </div>
                <div>
                  <label className="font-mono text-[8px] text-[#415161] tracking-[0.15em] uppercase">Access Key ID</label>
                  <input
                    className="w-full mt-1 px-2 py-1.5 bg-[#0f1923] border border-[#1f2f40] rounded-[2px] font-mono text-[11px] text-[#e8eaf0] focus:border-[#ff9900] outline-none"
                    value={creds.accessKeyId}
                    onChange={(e) => setCreds((c) => ({ ...c, accessKeyId: e.target.value }))}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label className="font-mono text-[8px] text-[#415161] tracking-[0.15em] uppercase">Secret Access Key</label>
                  <div className="relative mt-1">
                    <input
                      type={showSecret ? "text" : "password"}
                      className="w-full px-2 py-1.5 pr-7 bg-[#0f1923] border border-[#1f2f40] rounded-[2px] font-mono text-[11px] text-[#e8eaf0] focus:border-[#ff9900] outline-none"
                      value={creds.secretAccessKey}
                      onChange={(e) => setCreds((c) => ({ ...c, secretAccessKey: e.target.value }))}
                      placeholder="wJalrXUtnFEMI/K7MDENG"
                      autoComplete="off"
                    />
                    <button
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#415161] hover:text-[#7f9ab0]"
                    >
                      {showSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="font-mono text-[8px] text-[#415161] tracking-[0.15em] uppercase">Session Token (optional)</label>
                  <input
                    className="w-full mt-1 px-2 py-1.5 bg-[#0f1923] border border-[#1f2f40] rounded-[2px] font-mono text-[10px] text-[#e8eaf0] focus:border-[#ff9900] outline-none"
                    value={creds.sessionToken}
                    onChange={(e) => setCreds((c) => ({ ...c, sessionToken: e.target.value }))}
                    placeholder="For temporary credentials"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="font-mono text-[8px] text-[#415161] tracking-[0.15em] uppercase">Default Region</label>
                  <select
                    className="w-full mt-1 px-2 py-1.5 bg-[#0f1923] border border-[#1f2f40] rounded-[2px] font-mono text-[11px] text-[#e8eaf0] focus:border-[#ff9900] outline-none"
                    value={creds.region}
                    onChange={(e) => setCreds((c) => ({ ...c, region: e.target.value }))}
                  >
                    {["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-west-2","eu-central-1","ap-southeast-1","ap-southeast-2","ap-northeast-1","ap-south-1","sa-east-1","ca-central-1"].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => void testConnection()}
                  disabled={credsLoading}
                  className="w-full py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 disabled:opacity-50 text-[#0f1923] font-mono font-bold text-[11px] tracking-wider rounded-[2px] transition-all flex items-center justify-center gap-2"
                >
                  {credsLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> TESTING…</> : <><Shield className="w-3 h-3" /> CONNECT</>}
                </button>
                <button
                  onClick={() => { setCreds({ accessKeyId: "", secretAccessKey: "", sessionToken: "", region: "us-east-1", profileName: "default" }); setCredsConnected(false); sessionStorage.removeItem(CREDS_KEY); }}
                  className="w-full py-1.5 text-[#415161] hover:text-[#f14c4c] font-mono text-[10px] transition-colors flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Clear Credentials
                </button>
              </div>
            )}
          </div>

          {/* Quick commands */}
          <div className="bg-[#141f2e] border border-[#1f2f40] rounded-[3px] overflow-hidden flex-1">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1f2f40]">
              <BookOpen className="w-3.5 h-3.5 text-[#415161]" />
              <span className="font-mono text-[11px] font-bold text-[#7f9ab0] tracking-wider">QUICK COMMANDS</span>
            </div>
            <div className="p-2 space-y-1 overflow-y-auto max-h-[400px]">
              {QUICK_COMMANDS.map((qc) => (
                <button
                  key={qc.cmd}
                  onClick={() => void execCommand(qc.cmd)}
                  disabled={loading}
                  className="w-full text-left px-2.5 py-2 rounded-[2px] bg-[#0f1923] hover:bg-[#1a2535] border border-transparent hover:border-[#1f2f40] transition-all group"
                >
                  <div className="font-mono text-[10px] text-[#9ca3af] group-hover:text-[#e8eaf0] transition-colors">{qc.label}</div>
                  <div className="font-mono text-[8px] text-[#2a3f54] group-hover:text-[#415161] truncate">{qc.cmd}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel — terminal */}
        <div className="flex-1 flex flex-col bg-[#08111a] border border-[#1f2f40] rounded-[3px] overflow-hidden min-h-0">
          {/* Terminal header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#1f2f40] bg-[#0f1923] flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#f14c4c]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#1db954]" />
              </div>
              <span className="font-mono text-[10px] text-[#415161] ml-2">
                guardai — {creds.profileName}@{creds.region}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {loading && <Loader2 className="w-3 h-3 text-[#ff9900] animate-spin" />}
              <button
                onClick={() => setLines([{ id: crypto.randomUUID(), kind: "info", content: "Terminal cleared.", ts: Date.now() }])}
                className="text-[#415161] hover:text-[#7f9ab0] transition-colors"
                title="Clear"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Output area */}
          <div
            ref={outputRef}
            className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[12px] leading-relaxed cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {lines.map((line) => (
              <div key={line.id} className="group relative">
                {line.kind === "input" && (
                  <div className="flex items-start gap-2">
                    <span className="text-[#ff9900] select-none flex-shrink-0">❯</span>
                    <span className="text-[#e8eaf0]">{line.content}</span>
                  </div>
                )}
                {line.kind === "output" && (
                  <div className="relative">
                    <pre className="text-[#7f9ab0] whitespace-pre-wrap break-all pl-4 border-l border-[#1f2f40]">{line.content}</pre>
                    <button
                      onClick={() => copyLine(line.content)}
                      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1 text-[#415161] hover:text-[#ff9900] transition-all"
                    >
                      {copied === line.content.slice(0, 20) ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                )}
                {line.kind === "error" && (
                  <pre className="text-[#f14c4c] whitespace-pre-wrap pl-4 border-l border-[#ff1a1a40]">{line.content}</pre>
                )}
                {line.kind === "info" && (
                  <pre className="text-[#415161] whitespace-pre-wrap">{line.content}</pre>
                )}
                {line.kind === "help" && (
                  <pre className="text-[#7f9ab0] whitespace-pre-wrap text-[11px]">{line.content}</pre>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[#415161]">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Executing…</span>
              </div>
            )}
          </div>

          {/* Input row */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1f2f40] bg-[#0f1923] flex-shrink-0">
            <ChevronRight className="w-3.5 h-3.5 text-[#ff9900] flex-shrink-0" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent font-mono text-[12px] text-[#e8eaf0] outline-none placeholder:text-[#2a3f54]"
              placeholder="aws sts get-caller-identity"
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            <button
              onClick={() => void execCommand(input)}
              disabled={loading || !input.trim()}
              className="px-2.5 py-1 bg-[#ff9900] hover:bg-[#ff9900]/90 disabled:opacity-30 text-[#0f1923] font-mono font-bold text-[10px] rounded-[2px] transition-all"
            >
              RUN
            </button>
          </div>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#ff990006] border border-[#ff990015] rounded-[3px]">
        <Shield className="w-3 h-3 text-[#ff9900] flex-shrink-0" />
        <p className="font-mono text-[9px] text-[#415161]">
          Credentials are stored in your browser session only and sent directly to AWS via our API server. They are never persisted to our database. Use IAM roles with least-privilege access. Session clears on browser close.
        </p>
        <TerminalIcon className="w-3 h-3 text-[#415161] flex-shrink-0" />
      </div>
    </div>
  );
}

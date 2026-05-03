/**
 * AWS Accounts — Multi-account management
 *
 * Register and manage multiple AWS accounts.
 * Each account gets its own webhook token for GuardDuty ingestion.
 */
import { useState, useEffect, useCallback } from "react";
import { Building2, Plus, Trash2, Check, Copy, Edit2, Globe, Shield, X, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AwsAccount {
  id: number;
  name: string;
  accountId: string;
  region: string;
  environment: string;
  webhookToken: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

const ENVIRONMENTS = ["production", "staging", "development", "sandbox"];
const REGIONS = ["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-west-2","eu-central-1","ap-southeast-1","ap-southeast-2","ap-northeast-1","ap-south-1","sa-east-1","ca-central-1"];

const ENV_COLOR: Record<string, string> = {
  production: "#f14c4c",
  staging: "#f59e0b",
  development: "#60a5fa",
  sandbox: "#1db954",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 text-[var(--cs-text-muted)] hover:text-[#ff9900] transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-[#1db954]" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export function Accounts() {
  const [accounts, setAccounts] = useState<AwsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "", accountId: "", region: "us-east-1", environment: "production", notes: "",
  });

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/accounts`, { credentials: "include" });
      if (r.ok) setAccounts(await r.json() as AwsAccount[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  const resetForm = () => { setForm({ name: "", accountId: "", region: "us-east-1", environment: "production", notes: "" }); setShowForm(false); setEditId(null); };

  const handleSubmit = async () => {
    if (!form.name || !form.accountId) { toast({ title: "Name and Account ID are required", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const url = editId ? `${BASE_URL}/api/accounts/${editId}` : `${BASE_URL}/api/accounts`;
      const method = editId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (r.ok) {
        toast({ title: editId ? "Account updated" : "Account registered" });
        resetForm();
        void fetchAccounts();
      } else {
        const err = await r.json() as { error: string };
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Remove account "${name}"? This won't delete any alerts.`)) return;
    await fetch(`${BASE_URL}/api/accounts/${id}`, { method: "DELETE", credentials: "include" });
    toast({ title: `Removed ${name}` });
    void fetchAccounts();
  };

  const handleEdit = (a: AwsAccount) => {
    setForm({ name: a.name, accountId: a.accountId, region: a.region, environment: a.environment, notes: a.notes ?? "" });
    setEditId(a.id);
    setShowForm(true);
  };

  const webhookUrl = (token: string | null) => token
    ? `${window.location.origin}/api/integrations/guardduty/webhook`
    : null;

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono font-bold text-[20px] tracking-tight text-[var(--cs-text)]">AWS ACCOUNTS</h1>
          <p className="font-mono text-[10px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-0.5">Multi-account GuardDuty monitoring — each account gets its own webhook</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void fetchAccounts()} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-3 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 text-[#0f1923] font-mono font-bold text-[11px] tracking-wider rounded-[2px] transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> ADD ACCOUNT
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Accounts", value: accounts.length, color: "var(--cs-orange)" },
          { label: "Production", value: accounts.filter((a) => a.environment === "production").length, color: "#f14c4c" },
          { label: "Non-Prod", value: accounts.filter((a) => a.environment !== "production").length, color: "#f59e0b" },
          { label: "Active", value: accounts.filter((a) => a.status === "active").length, color: "#1db954" },
        ].map((s) => (
          <div key={s.label} className="bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] p-4">
            <div className="font-mono text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em] mt-1">{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-[var(--cs-surface)] border border-[#ff990030] rounded-[3px] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--cs-border)]">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#ff9900]" />
              <span className="font-mono text-[12px] font-bold text-[var(--cs-text)]">{editId ? "EDIT ACCOUNT" : "REGISTER ACCOUNT"}</span>
            </div>
            <button onClick={resetForm} className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)]"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.15em]">ACCOUNT NAME *</label>
              <input
                className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] font-mono text-[12px] text-[var(--cs-text)] focus:border-[var(--cs-orange)] outline-none"
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Production — US East"
              />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.15em]">AWS ACCOUNT ID *</label>
              <input
                className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] font-mono text-[12px] text-[var(--cs-text)] focus:border-[var(--cs-orange)] outline-none"
                value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                placeholder="123456789012" maxLength={12}
              />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.15em]">DEFAULT REGION</label>
              <select
                className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] font-mono text-[12px] text-[var(--cs-text)] focus:border-[var(--cs-orange)] outline-none"
                value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
              >
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.15em]">ENVIRONMENT</label>
              <select
                className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] font-mono text-[12px] text-[var(--cs-text)] focus:border-[var(--cs-orange)] outline-none"
                value={form.environment} onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
              >
                {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.15em]">NOTES</label>
              <textarea
                className="w-full px-3 py-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] font-mono text-[12px] text-[var(--cs-text)] focus:border-[var(--cs-orange)] outline-none resize-none"
                rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes about this account…"
              />
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 font-mono text-[11px] text-[var(--cs-text-muted)] hover:text-[var(--cs-text-dim)] transition-colors">Cancel</button>
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="px-4 py-2 bg-[#ff9900] hover:bg-[#ff9900]/90 disabled:opacity-50 text-[#0f1923] font-mono font-bold text-[11px] rounded-[2px] transition-all"
              >
                {submitting ? "Saving…" : editId ? "Update Account" : "Register Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account list */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <span className="font-mono text-[11px] text-[var(--cs-text-muted)] animate-pulse">Loading accounts…</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-3 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
          <Building2 className="w-6 h-6 text-[var(--cs-border2)]" />
          <span className="font-mono text-[11px] text-[var(--cs-text-muted)]">No accounts registered yet</span>
          <button onClick={() => setShowForm(true)} className="font-mono text-[11px] text-[#ff9900] hover:underline">Register your first account →</button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--cs-border)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[3px] bg-[var(--cs-surface2)] border border-[var(--cs-border)] flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-[var(--cs-text-muted)]" />
                  </div>
                  <div>
                    <div className="font-mono text-[13px] font-bold text-[var(--cs-text)]">{account.name}</div>
                    <div className="font-mono text-[10px] text-[var(--cs-text-muted)]">{account.accountId} · {account.region}</div>
                  </div>
                  <span
                    className="px-2 py-[2px] rounded-[2px] font-mono text-[9px] font-bold uppercase"
                    style={{ backgroundColor: (ENV_COLOR[account.environment] ?? "var(--cs-text-muted)") + "18", color: ENV_COLOR[account.environment] ?? "var(--cs-text-muted)", border: `1px solid ${(ENV_COLOR[account.environment] ?? "var(--cs-text-muted)")}30` }}
                  >
                    {account.environment}
                  </span>
                  <span className={`px-1.5 py-[2px] rounded-[2px] font-mono text-[8px] font-bold ${account.status === "active" ? "bg-[#1db95418] text-[#1db954] border border-[#1db95430]" : "bg-[#41516118] text-[var(--cs-text-muted)] border border-[#41516130]"}`}>
                    {account.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleEdit(account)} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[#ff9900] transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => void handleDelete(account.id, account.name)} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[#f14c4c] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="px-5 py-3 grid grid-cols-2 gap-4">
                {/* Webhook URL */}
                <div className="space-y-1.5">
                  <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">WEBHOOK ENDPOINT</div>
                  <div className="flex items-center gap-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] px-2 py-1.5">
                    <Globe className="w-3 h-3 text-[var(--cs-text-muted)] flex-shrink-0" />
                    <span className="font-mono text-[10px] text-[var(--cs-text-dim)] truncate flex-1">
                      {webhookUrl(account.webhookToken) ?? "—"}
                    </span>
                    {account.webhookToken && <CopyButton text={webhookUrl(account.webhookToken)!} />}
                  </div>
                </div>
                {/* Webhook token */}
                <div className="space-y-1.5">
                  <div className="font-mono text-[9px] text-[var(--cs-text-muted)] tracking-[0.1em]">X-GUARDAI-TOKEN</div>
                  <div className="flex items-center gap-2 bg-[var(--cs-bg)] border border-[var(--cs-border)] rounded-[2px] px-2 py-1.5">
                    <Shield className="w-3 h-3 text-[var(--cs-text-muted)] flex-shrink-0" />
                    <span className="font-mono text-[10px] text-[var(--cs-text-dim)] truncate flex-1">
                      {account.webhookToken ? `${account.webhookToken.slice(0, 12)}••••••••` : "—"}
                    </span>
                    {account.webhookToken && <CopyButton text={account.webhookToken} />}
                  </div>
                </div>
                {account.notes && (
                  <div className="col-span-2">
                    <div className="font-mono text-[9px] text-[var(--cs-border2)]">{account.notes}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

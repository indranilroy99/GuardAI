/**
 * Notifications — Alert channel configuration
 * Slack incoming webhook + Email (SMTP) with test buttons.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Bell, Slack, Mail, Check, X, Loader2, ChevronDown,
  AlertTriangle, CheckCircle2, Send, Eye, EyeOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const T = {
  bg:      "var(--cs-bg)",
  surface: "var(--cs-surface)",
  surface2:"var(--cs-surface2)",
  border:  "var(--cs-border)",
  border2: "var(--cs-border2)",
  text:    "var(--cs-text)",
  dim:     "var(--cs-text-dim)",
  muted:   "var(--cs-text-muted)",
  orange:  "var(--cs-orange)",
  blue:    "#00a8e6",
  green:   "#1db954",
  red:     "#f14c4c",
  mono:    "'JetBrains Mono', monospace",
};

type SeverityThreshold = "CRITICAL" | "HIGH" | "MEDIUM";

interface NotifConfig {
  severityThreshold: SeverityThreshold;
  slack: { enabled: boolean; webhookUrl: string; mentionChannel: boolean };
  email: { enabled: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string; smtpPass: string; fromAddress: string; toAddresses: string[] };
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors"
      style={{ background: checked ? T.orange : T.muted }}
    >
      <span className="inline-block h-4 w-4 mt-0.5 rounded-full bg-white transition-transform shadow-sm"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }} />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: T.dim }}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px]" style={{ color: T.muted }}>{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder, disabled }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string; disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 rounded-sm text-[12px] font-mono outline-none transition-colors"
      style={{ background: T.bg, border: `1px solid ${T.border2}`, color: T.text, opacity: disabled ? 0.5 : 1 }}
      onFocus={e => (e.currentTarget.style.borderColor = T.orange)}
      onBlur={e => (e.currentTarget.style.borderColor = T.border2)}
    />
  );
}

export function Notifications() {
  const [cfg, setCfg] = useState<NotifConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [toInput, setToInput] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/api/notifications/config`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json() as NotifConfig;
        setCfg(d);
        setToInput(d.email.toAddresses.join(", "));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const payload = { ...cfg, email: { ...cfg.email, toAddresses: toInput.split(",").map(s => s.trim()).filter(Boolean) } };
      const r = await fetch(`${BASE_URL}/api/notifications/config`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Save failed");
      toast({ title: "Notification settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const testSlack = async () => {
    if (!cfg) return;
    setTestingSlack(true);
    try {
      const r = await fetch(`${BASE_URL}/api/notifications/test/slack`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: cfg.slack.webhookUrl }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) toast({ title: "✓ Slack test delivered successfully" });
      else toast({ title: `Slack test failed: ${d.error ?? "Unknown error"}`, variant: "destructive" });
    } catch {
      toast({ title: "Slack test failed", variant: "destructive" });
    } finally {
      setTestingSlack(false);
    }
  };

  const testEmail = async () => {
    if (!cfg) return;
    setTestingEmail(true);
    try {
      const addresses = toInput.split(",").map(s => s.trim()).filter(Boolean);
      const r = await fetch(`${BASE_URL}/api/notifications/test/email`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg.email, toAddresses: addresses }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) toast({ title: "✓ Email test sent successfully" });
      else toast({ title: `Email test failed: ${d.error ?? "Unknown error"}`, variant: "destructive" });
    } catch {
      toast({ title: "Email test failed", variant: "destructive" });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading || !cfg) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2" style={{ color: T.dim }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="font-mono text-[11px]">Loading notification config…</span>
        </div>
      </div>
    );
  }

  const slackActive = cfg.slack.enabled && !!cfg.slack.webhookUrl;
  const emailActive = cfg.email.enabled && !!cfg.email.smtpHost && cfg.email.toAddresses.length > 0;

  return (
    <div className="max-w-2xl space-y-5 pb-12">

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: T.text }}>Alert Notifications</h1>
          <p className="text-[12px] mt-0.5" style={{ color: T.dim }}>Get notified via Slack or email when findings meet your severity threshold</p>
        </div>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-sm font-semibold text-[12px] transition-all"
          style={{ background: T.orange, color: "#000", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save changes
        </button>
      </div>

      {/* Severity threshold */}
      <div className="rounded-sm p-5" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4" style={{ color: T.orange }} />
          <span className="font-semibold text-[13px]" style={{ color: T.text }}>Notification threshold</span>
        </div>
        <div className="flex items-center gap-3">
          {(["CRITICAL", "HIGH", "MEDIUM"] as SeverityThreshold[]).map(sev => {
            const active = cfg.severityThreshold === sev;
            const col = sev === "CRITICAL" ? T.red : sev === "HIGH" ? T.orange : T.dim;
            // hardcoded hex needed only for opacity-suffix concatenation
            const colHex = sev === "CRITICAL" ? "#f14c4c" : sev === "HIGH" ? "#ff9900" : "#7f8fa6";
            return (
              <button
                key={sev}
                onClick={() => setCfg(c => c ? { ...c, severityThreshold: sev } : c)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-sm text-[11px] font-mono font-bold transition-all flex-1 justify-center"
                style={{
                  background: active ? `${colHex}20` : T.surface2,
                  border: `1px solid ${active ? colHex + "60" : T.border}`,
                  color: active ? col : T.muted,
                }}
              >
                {active && <Check className="w-3 h-3" />}
                {sev}+
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px]" style={{ color: T.muted }}>
          Notify me for <strong style={{ color: T.text }}>{cfg.severityThreshold}</strong> and above. Findings below this threshold are silently ingested.
        </p>
      </div>

      {/* Slack */}
      <div className="rounded-sm overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: cfg.slack.enabled ? `1px solid ${T.border}` : "none" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm flex items-center justify-center" style={{ background: "#4A154B20", border: "1px solid #4A154B60" }}>
              <Slack className="w-4 h-4" style={{ color: "#E01E5A" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[13px]" style={{ color: T.text }}>Slack</span>
                {slackActive && (
                  <span className="text-[9px] font-bold px-1.5 py-[2px] rounded-sm" style={{ background: `${T.green}20`, color: T.green, border: `1px solid ${T.green}40` }}>ACTIVE</span>
                )}
              </div>
              <p className="text-[11px]" style={{ color: T.dim }}>Incoming webhook — instant alert in any channel</p>
            </div>
          </div>
          <ToggleSwitch checked={cfg.slack.enabled} onChange={v => setCfg(c => c ? { ...c, slack: { ...c.slack, enabled: v } } : c)} />
        </div>

        {cfg.slack.enabled && (
          <div className="p-5 space-y-4">
            <Field
              label="Webhook URL"
              hint={<>Create one at <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" style={{ color: T.blue }}>api.slack.com/apps</a> → Your App → Incoming Webhooks → Add New Webhook</>}
            >
              <Input
                value={cfg.slack.webhookUrl}
                onChange={v => setCfg(c => c ? { ...c, slack: { ...c.slack, webhookUrl: v } } : c)}
                placeholder="https://hooks.slack.com/services/T.../B.../..."
              />
            </Field>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-medium" style={{ color: T.text }}>Mention @channel</div>
                <div className="text-[11px]" style={{ color: T.muted }}>Sends a channel-wide mention on critical alerts</div>
              </div>
              <ToggleSwitch
                checked={cfg.slack.mentionChannel}
                onChange={v => setCfg(c => c ? { ...c, slack: { ...c.slack, mentionChannel: v } } : c)}
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void testSlack()}
                disabled={testingSlack || !cfg.slack.webhookUrl}
                className="flex items-center gap-2 px-4 py-2 rounded-sm text-[11px] font-mono font-semibold transition-all"
                style={{
                  background: T.surface2,
                  border: `1px solid ${T.border2}`,
                  color: T.dim,
                  opacity: !cfg.slack.webhookUrl ? 0.4 : 1,
                }}
              >
                {testingSlack ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Send test message
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Email */}
      <div className="rounded-sm overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: cfg.email.enabled ? `1px solid ${T.border}` : "none" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm flex items-center justify-center" style={{ background: `${T.blue}15`, border: `1px solid ${T.blue}40` }}>
              <Mail className="w-4 h-4" style={{ color: T.blue }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[13px]" style={{ color: T.text }}>Email</span>
                {emailActive && (
                  <span className="text-[9px] font-bold px-1.5 py-[2px] rounded-sm" style={{ background: `${T.green}20`, color: T.green, border: `1px solid ${T.green}40` }}>ACTIVE</span>
                )}
              </div>
              <p className="text-[11px]" style={{ color: T.dim }}>SMTP — works with Gmail, Outlook, SendGrid, Postfix, etc.</p>
            </div>
          </div>
          <ToggleSwitch checked={cfg.email.enabled} onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, enabled: v } } : c)} />
        </div>

        {cfg.email.enabled && (
          <div className="p-5 space-y-4">
            {/* SMTP row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="SMTP host">
                  <Input
                    value={cfg.email.smtpHost}
                    onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, smtpHost: v } } : c)}
                    placeholder="smtp.gmail.com"
                  />
                </Field>
              </div>
              <Field label="Port">
                <Input
                  value={String(cfg.email.smtpPort)}
                  onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, smtpPort: parseInt(v) || 587 } } : c)}
                  placeholder="587"
                />
              </Field>
            </div>

            {/* TLS toggle */}
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-[12px] font-medium" style={{ color: T.text }}>Use TLS (port 465)</div>
                <div className="text-[11px]" style={{ color: T.muted }}>Enable for SSL/TLS. Leave off for STARTTLS (port 587)</div>
              </div>
              <ToggleSwitch
                checked={cfg.email.smtpSecure}
                onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, smtpSecure: v, smtpPort: v ? 465 : 587 } } : c)}
              />
            </div>

            {/* Credentials */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="SMTP username">
                <Input
                  value={cfg.email.smtpUser}
                  onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, smtpUser: v } } : c)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="SMTP password / app password">
                <div className="relative">
                  <Input
                    type={showSmtpPass ? "text" : "password"}
                    value={cfg.email.smtpPass}
                    onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, smtpPass: v } } : c)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPass(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                    style={{ color: T.muted }}
                  >
                    {showSmtpPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </Field>
            </div>

            <Field label="From address" hint='e.g. "GuardAI Alerts" <alerts@yourcompany.com>'>
              <Input
                value={cfg.email.fromAddress}
                onChange={v => setCfg(c => c ? { ...c, email: { ...c.email, fromAddress: v } } : c)}
                placeholder="alerts@yourcompany.com"
              />
            </Field>

            <Field label="Recipients" hint="Comma-separated list of email addresses that receive alerts">
              <Input
                value={toInput}
                onChange={setToInput}
                placeholder="security@yourcompany.com, oncall@yourcompany.com"
              />
            </Field>

            {/* Gmail hint */}
            <div className="flex items-start gap-2 p-3 rounded-sm" style={{ background: `${T.blue}08`, border: `1px solid ${T.blue}20` }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: T.blue }} />
              <p className="text-[11px]" style={{ color: T.dim }}>
                <strong style={{ color: T.text }}>Gmail tip:</strong> Use <code className="font-mono px-1" style={{ background: T.surface2 }}>smtp.gmail.com:587</code> with your Gmail address and an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: T.blue }}>App Password</a> (not your regular password). Requires 2FA enabled.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void testEmail()}
                disabled={testingEmail || !cfg.email.smtpHost || !toInput.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-sm text-[11px] font-mono font-semibold transition-all"
                style={{
                  background: T.surface2,
                  border: `1px solid ${T.border2}`,
                  color: T.dim,
                  opacity: !cfg.email.smtpHost || !toInput.trim() ? 0.4 : 1,
                }}
              >
                {testingEmail ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Send test email
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status summary */}
      <div className="rounded-sm p-4" style={{ background: T.surface2, border: `1px solid ${T.border}` }}>
        <div className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-3" style={{ color: T.muted }}>Channel status</div>
        <div className="flex items-center gap-6">
          {[
            { label: "Slack", active: slackActive, detail: slackActive ? "Webhook configured" : cfg.slack.enabled ? "Webhook URL missing" : "Disabled" },
            { label: "Email", active: emailActive, detail: emailActive ? `→ ${(cfg.email.toAddresses.length > 0 ? cfg.email.toAddresses : toInput.split(",").map(s => s.trim()).filter(Boolean)).join(", ")}` : cfg.email.enabled ? "SMTP host or recipients missing" : "Disabled" },
          ].map(({ label, active, detail }) => (
            <div key={label} className="flex items-center gap-2">
              {active
                ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: T.green }} />
                : <X className="w-3.5 h-3.5" style={{ color: T.muted }} />}
              <span className="text-[11px] font-medium" style={{ color: active ? T.text : T.muted }}>{label}</span>
              <span className="text-[10px]" style={{ color: T.muted }}>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

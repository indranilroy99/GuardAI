import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { storeSecure, retrieveAndDecrypt, clearSecureStorage } from "../lib/crypto";
import { Loader2, Check, Cpu, Key, Globe, MessageSquare, Zap, Shield, Brain, Network } from "lucide-react";

const AGENT_KEY = "guardaiAgentConfig";

interface AgentConfig {
  provider: "openai" | "anthropic" | "custom";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPromptSuffix?: string;
}

const PROVIDERS = {
  openai: {
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    defaultBaseUrl: "https://api.openai.com/v1",
    accent: "#74aa9c",
    desc: "GPT-4o recommended for best MITRE mapping accuracy.",
  },
  anthropic: {
    name: "Anthropic",
    models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"],
    defaultBaseUrl: "https://api.anthropic.com/v1",
    accent: "#d4a27a",
    desc: "Claude excels at long-context investigation reports.",
  },
  custom: {
    name: "Custom / Self-hosted",
    models: [],
    defaultBaseUrl: "",
    accent: "var(--cs-orange)",
    desc: "Any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, etc.).",
  },
} as const;

const CAPABILITIES = [
  { icon: Brain, name: "ALERT ANALYSIS", desc: "MITRE ATT&CK mapping using your agent's reasoning" },
  { icon: Zap, name: "INVESTIGATION REPORT", desc: "AI-powered CloudTrail correlation and threat narrative" },
  { icon: Network, name: "BLAST RADIUS CALC", desc: "Maps IAM permissions of compromised resources" },
  { icon: Shield, name: "KILL CHAIN RECON", desc: "Attack events mapped to MITRE kill chain stages" },
  { icon: MessageSquare, name: "NATURAL LANGUAGE QUERY", desc: "Plain-English alert queue filtering" },
  { icon: Cpu, name: "REMEDIATION SCRIPTS", desc: "Boto3 quarantine and containment code generation" },
];

export function Agents() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [activeConfig, setActiveConfig] = useState<AgentConfig | null>(null);
  const [form, setForm] = useState<AgentConfig>({
    provider: "openai",
    apiKey: "",
    model: "gpt-4o",
    baseUrl: "",
    systemPromptSuffix: "",
  });

  useEffect(() => {
    async function load() {
      try {
        const stored = await retrieveAndDecrypt(AGENT_KEY);
        if (stored) {
          const config = JSON.parse(stored) as AgentConfig;
          setActiveConfig(config);
          setForm({ ...config, apiKey: "" });
        }
      } catch {}
      setIsLoading(false);
    }
    load();
  }, []);

  const provider = PROVIDERS[form.provider];

  async function handleSave() {
    const keyToUse = form.apiKey || activeConfig?.apiKey || "";
    if (!keyToUse) {
      toast({ title: "API key required", description: "Enter your provider API key to continue.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const config: AgentConfig = {
        provider: form.provider,
        apiKey: keyToUse,
        model: form.model || PROVIDERS[form.provider].models[0] || "gpt-4o",
        baseUrl: form.baseUrl || undefined,
        systemPromptSuffix: form.systemPromptSuffix || undefined,
      };
      await storeSecure(AGENT_KEY, JSON.stringify(config));
      setActiveConfig(config);
      setForm(p => ({ ...p, apiKey: "" }));
      toast({ title: "Agent saved", description: `${PROVIDERS[config.provider].name} · ${config.model}` });
    } catch (e: unknown) {
      toast({ title: "Save failed", description: (e as Error)?.message, variant: "destructive" });
    }
    setIsSaving(false);
  }

  async function handleDisconnect() {
    clearSecureStorage(AGENT_KEY);
    setActiveConfig(null);
    setForm({ provider: "openai", apiKey: "", model: "gpt-4o", baseUrl: "", systemPromptSuffix: "" });
    toast({ title: "Agent disconnected", description: "Reverting to default server agent." });
  }

  async function handleTest() {
    const key = form.apiKey || activeConfig?.apiKey;
    if (!key) {
      toast({ title: "No API key", description: "Enter or save an API key first.", variant: "destructive" });
      return;
    }
    setIsTesting(true);
    try {
      const baseUrl = form.baseUrl || provider.defaultBaseUrl || "https://api.openai.com/v1";
      const model = form.model || (provider.models as readonly string[])[0] || "gpt-4o";
      const isAnthropic = form.provider === "anthropic";

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (isAnthropic) {
        headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["Authorization"] = `Bearer ${key}`;
      }

      const endpoint = isAnthropic
        ? `${baseUrl}/messages`
        : `${baseUrl}/chat/completions`;

      const body = isAnthropic
        ? { model, max_tokens: 10, messages: [{ role: "user", content: "Reply OK" }] }
        : { model, max_tokens: 5, messages: [{ role: "user", content: "Reply OK" }] };

      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });

      if (res.ok) {
        toast({ title: "Connection successful", description: `${PROVIDERS[form.provider].name} responded. Agent is ready.` });
      } else {
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
        toast({ title: "Connection failed", description: msg, variant: "destructive" });
      }
    } catch (e: unknown) {
      toast({ title: "Test failed", description: (e as Error)?.message, variant: "destructive" });
    }
    setIsTesting(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--cs-text-muted)] font-mono text-[12px]">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading encrypted config…
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--cs-text)]">AI AGENT HUB</h1>
          <p className="text-[11px] font-mono text-[var(--cs-text-muted)] mt-1">
            Connect your own LLM to power all AI-driven investigations. API key is encrypted with AES-256-GCM.
          </p>
        </div>
        {activeConfig && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#ff990018] border border-[#ff990040] rounded-[3px]">
            <div className="w-[5px] h-[5px] rounded-full bg-[#ff9900]" />
            <span className="font-mono text-[11px] text-[#ff9900]">
              {PROVIDERS[activeConfig.provider].name} · {activeConfig.model}
            </span>
          </div>
        )}
      </div>

      <div className="h-[1px] w-full bg-[var(--cs-border)]" />

      {/* Provider picker */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-3">PROVIDER</div>
        <div className="grid grid-cols-3 gap-3">
          {(Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map(key => {
            const p = PROVIDERS[key];
            const isSelected = form.provider === key;
            return (
              <button
                key={key}
                onClick={() => setForm(prev => ({
                  ...prev,
                  provider: key,
                  model: (p.models as readonly string[])[0] || prev.model,
                  baseUrl: "",
                }))}
                className="p-4 border rounded-[3px] text-left transition-all"
                style={{
                  borderColor: isSelected ? p.accent + "60" : "var(--cs-border)",
                  backgroundColor: isSelected ? p.accent + "10" : "var(--cs-surface)",
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-3.5 h-3.5 flex-shrink-0" style={{ color: p.accent }} />
                  <span className="font-mono text-[12px]" style={{ color: isSelected ? p.accent : "var(--cs-text-dim)" }}>
                    {p.name}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--cs-text-muted)] font-mono leading-tight">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Config form */}
      <div className="space-y-4 p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
        {/* API Key */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono flex items-center gap-1.5">
            <Key className="w-3 h-3" /> API KEY
          </label>
          <input
            type="password"
            value={form.apiKey}
            onChange={e => setForm(p => ({ ...p, apiKey: e.target.value }))}
            placeholder={activeConfig ? "•••••••••••• (leave blank to keep existing)" : "sk-... / sk-ant-..."}
            className="w-full bg-[var(--cs-bg)] border border-[var(--cs-border)] text-[13px] font-mono text-[var(--cs-text)] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)] transition-colors placeholder:text-[var(--cs-border2)]"
          />
          <p className="text-[10px] font-mono text-[var(--cs-border2)]">
            Encrypted with AES-256-GCM using a session key stored in sessionStorage. Cleared automatically on tab close or after 30min of inactivity.
          </p>
        </div>

        {/* Model + Base URL */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono">MODEL</label>
            {(provider.models as readonly string[]).length > 0 ? (
              <select
                value={form.model}
                onChange={e => setForm(p => ({ ...p, model: e.target.value }))}
                className="w-full bg-[var(--cs-bg)] border border-[var(--cs-border)] text-[13px] font-mono text-[var(--cs-text)] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)]"
              >
                {(provider.models as readonly string[]).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.model}
                onChange={e => setForm(p => ({ ...p, model: e.target.value }))}
                placeholder="model-name"
                className="w-full bg-[var(--cs-bg)] border border-[var(--cs-border)] text-[13px] font-mono text-[var(--cs-text)] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)] placeholder:text-[var(--cs-border2)]"
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono flex items-center gap-1.5">
              <Globe className="w-3 h-3" /> BASE URL
              {form.provider !== "custom" && <span className="text-[var(--cs-border2)] normal-case">(optional override)</span>}
            </label>
            <input
              type="text"
              value={form.baseUrl || ""}
              onChange={e => setForm(p => ({ ...p, baseUrl: e.target.value }))}
              placeholder={provider.defaultBaseUrl || "https://your-server.com/v1"}
              className="w-full bg-[var(--cs-bg)] border border-[var(--cs-border)] text-[13px] font-mono text-[var(--cs-text)] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)] placeholder:text-[var(--cs-border2)]"
            />
          </div>
        </div>

        {/* System Prompt */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" /> SYSTEM PROMPT AUGMENTATION
            <span className="text-[var(--cs-border2)] normal-case">(optional)</span>
          </label>
          <textarea
            value={form.systemPromptSuffix || ""}
            onChange={e => setForm(p => ({ ...p, systemPromptSuffix: e.target.value }))}
            placeholder="Context appended to all analysis prompts. E.g.: 'Our AWS account uses only us-east-1. IAM roles prefixed prod- are production-critical and must be treated as high-value targets.'"
            rows={3}
            className="w-full bg-[var(--cs-bg)] border border-[var(--cs-border)] text-[12px] font-mono text-[var(--cs-text)] px-3 py-2 rounded-[3px] focus:outline-none focus:border-[var(--cs-orange)] placeholder:text-[var(--cs-border2)] resize-none"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 border border-[#ff990040] bg-[#ff990018] text-[#ff9900] font-mono text-[11px] uppercase tracking-wide rounded-[3px] hover:bg-[#ff990030] transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            SAVE AGENT
          </button>
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="flex items-center gap-1.5 px-4 py-2 border border-[var(--cs-border)] bg-transparent text-[var(--cs-text-dim)] font-mono text-[11px] uppercase tracking-wide rounded-[3px] hover:text-[var(--cs-text)] hover:border-[var(--cs-text-muted)] transition-colors disabled:opacity-50"
          >
            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            TEST CONNECTION
          </button>
          {activeConfig && (
            <button
              onClick={handleDisconnect}
              className="ml-auto text-[11px] font-mono text-[var(--cs-text-muted)] hover:text-[#f14c4c] transition-colors"
            >
              DISCONNECT
            </button>
          )}
        </div>
      </div>

      {/* Capability matrix */}
      <div className="p-5 bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-[3px]">
        <div className="text-[10px] uppercase tracking-widest text-[var(--cs-text-muted)] font-mono mb-4">AGENT-POWERED CAPABILITIES</div>
        <div className="grid grid-cols-2 gap-3">
          {CAPABILITIES.map(cap => (
            <div key={cap.name} className="flex items-start gap-3">
              <cap.icon
                className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                style={{ color: activeConfig ? "var(--cs-orange)" : "var(--cs-text-muted)" }}
              />
              <div>
                <div className={`font-mono text-[11px] ${activeConfig ? "text-[var(--cs-text)]" : "text-[var(--cs-text-muted)]"}`}>
                  {cap.name}
                </div>
                <div className="font-mono text-[10px] text-[var(--cs-text-muted)]">{cap.desc}</div>
              </div>
            </div>
          ))}
        </div>
        {!activeConfig && (
          <div className="mt-4 pt-4 border-t border-[var(--cs-border)] text-[11px] font-mono text-[#f59e0b]">
            Configure an agent above to unlock custom AI. The server default will be used until then.
          </div>
        )}
      </div>

      {/* Security notice */}
      <div className="p-4 bg-[#ff990008] border border-[#ff990020] rounded-[3px]">
        <div className="text-[10px] uppercase tracking-widest text-[#ff990050] font-mono mb-2 flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> SECURITY MODEL
        </div>
        <ul className="space-y-1 text-[10px] font-mono text-[var(--cs-text-muted)]">
          <li>→ API key is encrypted with AES-256-GCM before being written to localStorage</li>
          <li>→ Encryption key lives only in sessionStorage — cleared automatically on tab close</li>
          <li>→ 30-minute inactivity timeout wipes the session key, making ciphertext unreadable</li>
          <li>→ API key is passed per-request to the server over HTTPS — never persisted server-side</li>
          <li>→ All agent API calls are logged in the Audit Log with key redacted</li>
        </ul>
      </div>
    </div>
  );
}

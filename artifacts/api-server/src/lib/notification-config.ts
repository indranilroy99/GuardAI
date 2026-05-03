/**
 * Notification channel configuration — persisted to disk as JSON.
 * Stored alongside the api-server process in ./data/notification-config.json.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "notification-config.json");

export type SeverityThreshold = "CRITICAL" | "HIGH" | "MEDIUM";

export interface SlackChannelConfig {
  enabled: boolean;
  webhookUrl: string;
  mentionChannel: boolean;
}

export interface EmailChannelConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  toAddresses: string[];
}

export interface NotificationConfig {
  severityThreshold: SeverityThreshold;
  slack: SlackChannelConfig;
  email: EmailChannelConfig;
}

const DEFAULT_CONFIG: NotificationConfig = {
  severityThreshold: "CRITICAL",
  slack: {
    enabled: false,
    webhookUrl: "",
    mentionChannel: false,
  },
  email: {
    enabled: false,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    fromAddress: "",
    toAddresses: [],
  },
};

let _config: NotificationConfig = { ...DEFAULT_CONFIG };

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadNotificationConfig(): NotificationConfig {
  try {
    ensureDataDir();
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      _config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    _config = { ...DEFAULT_CONFIG };
  }
  return _config;
}

export function getNotificationConfig(): NotificationConfig {
  return _config;
}

export function updateNotificationConfig(partial: Partial<NotificationConfig>): NotificationConfig {
  _config = {
    ..._config,
    ...partial,
    slack: { ..._config.slack, ...(partial.slack ?? {}) },
    email: { ..._config.email, ...(partial.email ?? {}) },
  };
  try {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), "utf-8");
  } catch { /* best-effort */ }
  return _config;
}

// Load on module init
loadNotificationConfig();

import fs from "fs";
import path from "path";
import os from "os";

export interface CLIConfig {
  apiUrl: string;
  token?: string;
  organizationId?: string;
  organizationName?: string;
  userId?: string;
  userName?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".guildserver");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CLIConfig {
  const defaults: CLIConfig = {
    apiUrl: process.env.GUILDSERVER_API_URL || "http://localhost:4000",
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch {
    // ignore parse errors
  }

  return defaults;
}

export function saveConfig(config: Partial<CLIConfig>): void {
  ensureConfigDir();
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function clearConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

export function isAuthenticated(): boolean {
  const config = loadConfig();
  return !!config.token;
}

export function getToken(): string {
  const config = loadConfig();
  if (!config.token) {
    throw new Error("Not authenticated. Run `guildserver login` first.");
  }
  return config.token;
}

export function getApiUrl(): string {
  return loadConfig().apiUrl;
}

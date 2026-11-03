// Your settings, in data/settings.json: the Brave Search API key the worker searches with, and whether the
// launcher installs new releases on start. Written by the Settings page and the installer, read by the worker
// (main.py brave_key) and the launcher. The key never goes to the browser in full: pages get maskedKey().
import fs from "node:fs";
import path from "node:path";
import { dataDirectory } from "./db.ts";

export type Settings = { autoUpdate: boolean; braveApiKey: string };
const file = (dataDir: string) => path.join(dataDir, "settings.json");

export function readSettings(dataDir = dataDirectory()): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(dataDir), "utf8"));
    return { autoUpdate: raw.autoUpdate === true, braveApiKey: typeof raw.braveApiKey === "string" ? raw.braveApiKey : "" };
  } catch {
    return { autoUpdate: false, braveApiKey: "" };
  }
}

// Merges into what is there, so saving one setting never drops another.
export function writeSettings(change: Partial<Settings>, dataDir = dataDirectory()) {
  const next = { ...readSettings(dataDir), ...change };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(dataDir), JSON.stringify({ autoUpdate: Boolean(next.autoUpdate), braveApiKey: next.braveApiKey.trim() }, null, 2) + "\n");
}

// Brave keys are letters, digits, underscores and hyphens; anything else is a paste gone wrong.
export function braveKeyError(key: string): string | null {
  const k = key.trim();
  if (!k) return "Paste a key first.";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(k)) return "That doesn't look like a Brave Search API key: it should be one word of letters and digits.";
  return null;
}

export const maskedKey = (key: string) => (key ? `${"•".repeat(8)}${key.slice(-4)}` : "");

// A key the worker will find: in settings.json, or set the old way (BRAVE_API_KEY in the environment or worker/.env).
export function hasBraveKey(dataDir = dataDirectory()) {
  if (readSettings(dataDir).braveApiKey || process.env.BRAVE_API_KEY) return true;
  try {
    const env = fs.readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../worker/.env"), "utf8");
    return /^BRAVE_API_KEY=\S+/m.test(env);
  } catch {
    return false;
  }
}

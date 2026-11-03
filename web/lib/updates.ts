// Telling you when a newer Quire is out. Once a day the server asks GitHub for the latest release of REPO and
// compares its tag with this copy's version; QUIRE_UPDATE_CHECK=off turns the check off (it is the only request
// Quire makes that is not a similarity search). Applying an update is the launcher's job (scripts/update.*),
// which also runs it on start when the autoUpdate setting is on (lib/settings.ts).
import fs from "node:fs";
import path from "node:path";

export const REPO = process.env.QUIRE_REPO || "chakradhar09/quire";
export const VERSION: string = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version;

// "v1.10.0" > "1.9.2"; anything after a hyphen (a pre-release) counts as older than the plain version.
export function newer(candidate: string, current: string) {
  const parts = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre !== undefined };
  };
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d > 0;
  }
  return b.pre && !a.pre;
}

export type Update = { version: string; url: string };

export async function availableUpdate(): Promise<Update | null> {
  if (process.env.QUIRE_UPDATE_CHECK === "off") return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 86_400 }, // once a day, however often pages render
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const release = (await r.json()) as { tag_name?: string; html_url?: string };
    return release.tag_name && newer(release.tag_name, VERSION) ? { version: release.tag_name.replace(/^v/, ""), url: release.html_url ?? "" } : null;
  } catch {
    return null; // offline, rate-limited or no releases yet: say nothing
  }
}

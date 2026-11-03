// The to-resolve list: every counted match and every AI passage of a draft in reading order, each open
// until the owner decides. Pure, so the report view and its keyboard shortcuts share it. Checked by
// resolve.test.ts (npm test).

export type ItemState = "open" | "cited" | "rewritten" | "kept" | "excluded";
export type Item = {
  key: string; kind: "match" | "ai"; start: number; end: number; state: ItemState;
  matchId?: number; rank?: number;
};
// What the owner can decide. "excluded" is the match's own flag (it changes the score); the rest are
// resolutions saved by range. null undoes.
export type Decision = "cited" | "rewritten" | "kept" | "excluded" | null;

type MatchIn = { id: number; start: number; end: number; rank: number | null; hidden: string | null; excluded: boolean };
type Saved = { kind: "match" | "ai"; start: number; end: number; state: "cited" | "rewritten" | "kept" };

export const keyOf = (kind: "match" | "ai", start: number, end: number) => `${kind}:${start}:${end}`;

export function buildItems({ matches, ai, resolutions }: {
  matches: MatchIn[]; ai: { start: number; end: number }[]; resolutions: Saved[];
}): Item[] {
  const saved = new Map(resolutions.map((r) => [keyOf(r.kind, r.start, r.end), r.state]));
  const items = new Map<string, Item>();
  for (const m of matches) {
    const counted = m.rank !== null && m.hidden === null && !m.excluded;
    if (!counted && !m.excluded) continue;
    const key = keyOf("match", m.start, m.end);
    if (items.has(key)) continue; // one decision per range, the best-ranked source's match stands for it
    items.set(key, {
      key, kind: "match", start: m.start, end: m.end, matchId: m.id, rank: m.rank ?? undefined,
      state: m.excluded ? "excluded" : saved.get(key) ?? "open",
    });
  }
  for (const a of ai) {
    const key = keyOf("ai", a.start, a.end);
    if (!items.has(key)) items.set(key, { key, kind: "ai", start: a.start, end: a.end, state: saved.get(key) ?? "open" });
  }
  // Matches were added first, and sort is stable, so a match comes before an AI passage that starts at the same place.
  return [...items.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

export const progress = (items: Item[]) => ({ done: items.filter((i) => i.state !== "open").length, total: items.length });

// The item after (dir 1) or before (dir -1) `from`; the first one when nothing is current. Stops at the ends.
export function step(items: Item[], from: string | undefined, dir: 1 | -1): string | undefined {
  if (!items.length) return undefined;
  const at = items.findIndex((i) => i.key === from);
  if (at < 0) return items[0].key;
  return items[Math.max(0, Math.min(items.length - 1, at + dir))].key;
}

// Keyboard: c cite, r rewrite, e exclude, p keep (an AI passage as written), z undo. undefined = not a decision key here.
export function decide(key: string, kind: "match" | "ai"): Decision | undefined {
  const k = key.toLowerCase();
  if (k === "z") return null;
  if (kind === "match") return k === "c" ? "cited" : k === "r" ? "rewritten" : k === "e" ? "excluded" : undefined;
  return k === "r" ? "rewritten" : k === "p" ? "kept" : undefined;
}

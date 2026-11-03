// Papers: drafts grouped into chains of versions (documents.parent_id). Pure, so the drafts page and
// the upload form share it. Checked by papers.test.ts (npm test).
import type { Draft } from "./db.ts";

// id is the first version's id; versions run oldest to newest; the title is the newest version's.
export type Paper = { id: number; title: string; versions: Draft[] };

export function groupPapers(drafts: Draft[]): Paper[] {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const rootOf = (d: Draft) => {
    const seen = new Set<number>();
    while (d.parentId !== null && byId.has(d.parentId) && !seen.has(d.id)) {
      seen.add(d.id);
      d = byId.get(d.parentId)!;
    }
    return d.id;
  };
  const groups = new Map<number, Draft[]>();
  for (const d of drafts) {
    const root = rootOf(d);
    groups.set(root, [...(groups.get(root) ?? []), d]);
  }
  const newest = (p: Paper) => p.versions[p.versions.length - 1];
  return [...groups].map(([id, versions]) => {
    versions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    return { id, title: versions[versions.length - 1].title, versions };
  }).sort((a, b) => newest(b).createdAt.localeCompare(newest(a).createdAt) || b.id - a.id);
}

// The part of a title that stays the same across versions: lower case, before any subtitle, without
// version words ("v3", "draft", "final", "IEEE format"). "Research_Paper_v3_IEEE" -> "research paper".
const VERSION_WORD = /^(v\d+|version|draft\d*|final|revised|rev\d*|copy|ieee|format|formatted|run)$/;
export function titleStem(title: string) {
  return title.toLowerCase().split(":")[0].replace(/[_\-.]+/g, " ").split(/\s+/)
    .filter((w) => w && !VERSION_WORD.test(w)).join(" ");
}

// The paper a new upload most likely continues, by title stem; undefined when none matches.
export function suggestPaper(title: string, papers: Pick<Paper, "id" | "title">[]) {
  const stem = titleStem(title);
  return stem ? papers.find((p) => titleStem(p.title) === stem)?.id : undefined;
}

// How the two scores moved between one version and the next, shown rounded as in the badges. A score only
// counts when both versions have finished it; one that did not move is left out.
export type VersionChange = { similarity?: [number, number]; ai?: [number, number] };
export function versionChange(prev: Draft, cur: Draft): VersionChange {
  const out: VersionChange = {};
  if (prev.reportStatus === "done" && cur.reportStatus === "done" && prev.score !== null && cur.score !== null) {
    const move: [number, number] = [Math.round(prev.score), Math.round(cur.score)];
    if (move[0] !== move[1]) out.similarity = move;
  }
  if (prev.aiStatus === "done" && cur.aiStatus === "done" && prev.aiScore !== null && cur.aiScore !== null) {
    const move: [number, number] = [Math.round(prev.aiScore), Math.round(cur.aiScore)];
    if (move[0] !== move[1]) out.ai = move;
  }
  return out;
}

// A title cut to at most `max` characters for menus and pickers: at the last word that fits when there is one
// past the halfway mark, mid-word otherwise (underscored file names are one long word), with an ellipsis.
export function shortTitle(title: string, max: number) {
  const t = title.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

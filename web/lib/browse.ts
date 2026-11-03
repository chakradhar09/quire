// Finding a paper in the drafts page list: a search over every version's title and entry number, and a sort.
// Pure, so the list can filter as you type without asking the server.

export type PaperKeys = {
  title: string; // the newest version's, for sorting by title
  titles: string[]; // every version's
  ids: number[]; // every version's entry number
  newest: number; // when the newest version was added (ms)
  ai: number | null; // the newest version's scores, null when there is none yet
  similarity: number | null;
};
export type PaperSort = "newest" | "ai" | "similarity" | "title";

// Underscores and hyphens count as spaces, so "soil erosion" finds "Lab_Report_1_SoilErosion".
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
const plain = (s: string) => words(s).replace(/\s+/g, "");

function matches(keys: PaperKeys, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // An entry number: "No. 013", "013" or "13".
  const num = q.match(/^(?:no\.?\s*)?0*(\d+)$/);
  if (num && keys.ids.includes(Number(num[1]))) return true;
  const hay = keys.titles.map((t) => `${words(t)} ${plain(t)}`).join(" ");
  return words(q).split(/\s+/).every((w) => hay.includes(w));
}

const desc = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);

// Versions deleted but still undoable leave the list at once. A paper left with none goes; one that lost a
// version drops its "since version N" line, which compared versions that are no longer side by side.
export function hideVersions<T extends { versions: { id: number }[]; change: unknown }>(papers: T[], hidden: ReadonlySet<number>): T[] {
  if (!hidden.size) return papers;
  return papers.flatMap((p) => {
    const versions = p.versions.filter((v) => !hidden.has(v.id));
    if (!versions.length) return [];
    return versions.length === p.versions.length ? [p] : [{ ...p, versions, change: null }];
  });
}

export function browsePapers<T extends { keys: PaperKeys }>(papers: T[], query: string, sort: PaperSort): T[] {
  const by: Record<PaperSort, (a: T, b: T) => number> = {
    newest: (a, b) => b.keys.newest - a.keys.newest,
    ai: (a, b) => desc(a.keys.ai, b.keys.ai),
    similarity: (a, b) => desc(a.keys.similarity, b.keys.similarity),
    title: (a, b) => a.keys.title.localeCompare(b.keys.title, "en", { sensitivity: "base" }),
  };
  return papers.filter((p) => matches(p.keys, query))
    .sort((a, b) => by[sort](a, b) || b.keys.newest - a.keys.newest);
}

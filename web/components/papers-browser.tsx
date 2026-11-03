"use client";
// The papers list with a search and a sort above it (lib/browse.ts does the finding). Filters as you type.
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { usePendingDeletes } from "@/app/pending-deletes";
import { browsePapers, hideVersions, type PaperKeys, type PaperSort } from "@/lib/browse";
import { Dropdown } from "./overlays";
import { PapersList, type PaperCard } from "./papers-list";
import { Button, INPUT, cx } from "./ui";

const SORTS: { value: PaperSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "ai", label: "Highest AI writing" },
  { value: "similarity", label: "Highest similarity" },
  { value: "title", label: "Title, A to Z" },
];

export function PapersBrowser({ papers: all }: { papers: (PaperCard & { keys: PaperKeys })[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PaperSort>("newest");
  const { hidden } = usePendingDeletes();
  const papers = useMemo(() => hideVersions(all, hidden), [all, hidden]);
  const shown = useMemo(() => browsePapers(papers, query, sort), [papers, query, sort]);

  return (
    <>
      {papers.length > 1 && (
        <div role="search" className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-56">
            <label htmlFor="paper-search" className="sr-only">Search papers</label>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input id="paper-search" type="search" value={query} autoComplete="off" spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or entry number"
              className={cx(INPUT, "h-10 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden")} />
            {query && (
              <button type="button" aria-label="Clear the search" onClick={() => setQuery("")}
                className="focus-ring absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-text">
                <X aria-hidden className="size-4" />
              </button>
            )}
          </div>
          <div className="w-52 shrink-0">
            <Dropdown id="paper-sort" label="Sort papers" hideLabel value={sort}
              onValueChange={(v) => setSort(v as PaperSort)}
              groups={[{ items: SORTS }]} />
          </div>
          <p aria-live="polite" className="w-full text-xs text-muted">
            {query ? `${shown.length} of ${papers.length} papers match` : `${papers.length} papers`}
          </p>
        </div>
      )}
      {shown.length > 0 ? (
        <PapersList papers={shown} />
      ) : !papers.length ? (
        <p className="rounded-lg border border-border bg-bg px-6 py-10 text-center text-sm text-muted">Every paper is deleted.</p>
      ) : (
        <div className="rounded-lg border border-border bg-bg px-6 py-10 text-center">
          <p className="font-semibold">No paper matches &ldquo;{query}&rdquo;</p>
          <p className="mt-1 text-sm text-muted">Titles of every version and entry numbers are searched.</p>
          <Button size="sm" variant="secondary" className="mt-4" onClick={() => setQuery("")}>Clear the search</Button>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DraftsTable, type DraftRow } from "@/components/drafts-table";
import { AppHeader, EmptyState, buttonClass, cx } from "@/components/ui";
import { listDrafts, type Draft } from "@/lib/db";
import { PapersBrowser } from "@/components/papers-browser";
import type { PaperCard } from "@/components/papers-list";
import { WorkerLight } from "@/components/worker-light";
import { BraveKeyNotice } from "@/components/brave-key-notice";
import type { PaperKeys } from "@/lib/browse";
import { groupPapers, titleStem, versionChange } from "@/lib/papers";
import { paperChoices } from "../paper-choices";
import { UploadForm } from "../submit/upload-form";

const REJECTED_BECAUSE: Record<string, string> = {
  too_few_words: "Fewer than 20 words",
  extraction_failed: "Couldn't read the text",
  image_only_pdf: "No selectable text (a scan?)",
  too_many_pages: "Over 800 pages",
  too_large: "Over 50 MB",
  unsupported_type: "Not a file type Quire reads",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const WORKER_NOTE = "Start it: python main.py in worker/";
const WAITING = { status: "waiting", note: WORKER_NOTE } as const;

const AI_UNAVAILABLE: Record<string, string> = {
  too_few_words: "fewer than 300 words of prose",
  unsupported_language: "not in English",
};

function aiBadge(d: Draft): DraftRow["ai"] {
  const href = `/documents/${d.id}/ai`;
  if (d.aiStatus === "done") return { score: d.aiScore ?? 0, href };
  if (d.aiStatus === "unavailable") return { state: "unavailable", reason: AI_UNAVAILABLE[d.aiReason ?? ""], href };
  if (d.aiStatus === "error") return { state: "error", href };
  return { state: "pending", href };
}

function toRow(d: Draft): DraftRow {
  const row: DraftRow = { id: d.id, title: d.title, submitted: when(d.createdAt) };
  if (d.status === "extracting") return { ...row, ...(d.waiting ? WAITING : { status: "processing" }) };
  if (d.status === "rejected") return { ...row, status: "rejected", note: REJECTED_BECAUSE[d.rejectReason ?? ""] };
  if (d.reportId === null) return row;
  const href = `/reports/${d.reportId}`;
  const similarity: DraftRow["similarity"] =
    d.reportStatus === "done" ? { score: d.score ?? 0, href } :
    d.reportStatus === "error" ? { state: "error", href } :
    d.reportStatus === "recalculating" ? { score: d.score ?? 0, state: "recalculating", href } :
    { state: "pending", href };
  return {
    ...row, href, similarity,
    ai: aiBadge(d),
    ...(d.waiting ? WAITING : { status: d.reportStatus === "error" ? "error" : undefined }),
  };
}

// S03. Drafts being read or checked are in the header's queue (WorkerLight), which also keeps the page
// refreshing until they finish; here they show on their paper's card with a "Checking" status.
async function Drafts() {
  await connection();
  const drafts = listDrafts();
  if (!drafts.length) {
    return (
      <div className="rounded-lg border border-border bg-bg">
        <EmptyState title="Nothing on the pad yet"
          body="Drop a file into the panel, or paste your text, and the first check starts as soon as it has been read." />
      </div>
    );
  }
  const papers = groupPapers(drafts);
  const cards: (PaperCard & { keys: PaperKeys })[] = papers.map((p) => {
    // Papers a version could join, the ones it looks like (same title stem) first.
    const othersFor = (d: Draft) => papers.filter((o) => o.id !== p.id)
      .sort((a, b) => Number(titleStem(b.title) === titleStem(d.title)) - Number(titleStem(a.title) === titleStem(d.title)))
      .slice(0, 8).map((o) => ({ id: o.id, title: o.title }));
    const actions = (d: Draft) => ({
      id: d.id, title: d.title, others: othersFor(d), inChain: p.versions.length > 1,
      retryReportId: d.reportStatus === "error" ? d.reportId : null,
    });
    const before = p.versions[p.versions.length - 2];
    const newest = p.versions[p.versions.length - 1];
    return {
      id: p.id,
      versions: p.versions.map((d, i) => ({ ...toRow(d), n: i + 1, actions: actions(d) })),
      change: before ? versionChange(before, newest) : null,
      keys: {
        title: newest.title, titles: p.versions.map((d) => d.title), ids: p.versions.map((d) => d.id),
        newest: Date.parse(newest.createdAt),
        ai: newest.aiStatus === "done" ? newest.aiScore : null,
        similarity: newest.reportStatus === "done" || newest.reportStatus === "recalculating" ? newest.score : null,
      },
    };
  });
  return (
    <>
      <PapersBrowser papers={cards} />
      {drafts.some((d) => d.aiStatus === "done" && (d.aiScore ?? 0) > 0 && (d.aiScore ?? 0) < 20) && (
        <p className="mt-3 text-xs text-muted">* AI estimate under 20%. Too unreliable to show.</p>
      )}
    </>
  );
}

// The intake form needs the papers a new draft could join, so it reads the database too.
async function Intake() {
  await connection();
  return <UploadForm papers={paperChoices()} />;
}

export default function Home() {
  return (
    <>
      <AppHeader current="drafts" intake status={<Suspense><WorkerLight /></Suspense>} />
      <div className="min-h-[calc(100dvh-3.5rem)]">
        <main id="main" className="mx-auto grid w-full max-w-content-max items-start gap-8 px-4 py-8 md:px-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_var(--layout-panel)]">
          <div className="min-w-0">
            <Suspense><BraveKeyNotice /></Suspense>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h1 className="text-xl">Papers</h1>
                <p className="mt-1 text-sm text-muted">Each version keeps its entry number. Open a score to see the passages behind it.</p>
              </div>
              {/* Below lg the intake panel follows the list (visual order = focus order); this jumps to it. */}
              <a href="#intake" className={cx(buttonClass("primary", "sm"), "shrink-0 lg:hidden")}>Check a draft</a>
            </div>
            <Suspense fallback={<div className="rounded-lg border border-border bg-bg"><DraftsTable rows={[]} loading /></div>}>
              <Drafts />
            </Suspense>
          </div>
          <aside id="intake" aria-labelledby="intake-heading" className="scroll-mt-20 rounded-lg border border-border bg-bg p-5 lg:sticky lg:top-20">
            <h2 id="intake-heading" className="text-lg">Check a draft</h2>
            <p className="mt-1 mb-4 text-sm text-pretty text-muted">Checked against the web as soon as it has been read.</p>
            <Suspense fallback={<UploadForm papers={[]} />}><Intake /></Suspense>
            <p className="mt-4 border-t border-border pt-4 text-sm">
              <Link href="/submit" className="focus-ring rounded-sm font-semibold text-accent underline">Paste text instead</Link>
            </p>
          </aside>
        </main>
      </div>
    </>
  );
}

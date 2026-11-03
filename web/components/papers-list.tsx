// The drafts page list: one card per paper, showing its newest version with both scores, the change since the
// version before, and the earlier versions as dated entries. No client state; row actions come in as nodes.
import Link from "next/link";
import type { VersionChange } from "@/lib/papers";
import type { DraftRow } from "./drafts-table";
import { VersionActions, type VersionActionsData } from "@/app/version-actions";
import { AiBadge, ScoreBadge } from "./score";
import { ExhibitTitle, StatusPill, exhibit } from "./ui";

export type VersionRow = DraftRow & { n: number; actions: VersionActionsData };
export type PaperCard = { id: number; versions: VersionRow[]; change: VersionChange | null };

// The versions as sheets, offset like a small stack (see .vstack in globals.css).
function VersionStack({ count }: { count: number }) {
  const sheets = Math.min(count, 3);
  return (
    <span aria-hidden className="vstack">
      {Array.from({ length: sheets }, (_, i) => sheets - 1 - i).map((k) => <i key={k} style={{ "--k": k } as React.CSSProperties} />)}
    </span>
  );
}

const move = ([from, to]: [number, number]) => <span className="font-mono text-text">{from}% → {to}%</span>;

function Change({ from, change }: { from: VersionRow; change: VersionChange }) {
  const parts = [
    change.ai && <span key="ai">AI writing {move(change.ai)}</span>,
    change.similarity && <span key="sim">similarity {move(change.similarity)}</span>,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <p className="mt-1.5 text-xs text-muted">
      Since version {from.n}: {parts.map((p, i) => <span key={i}>{i > 0 && ", "}{p}</span>)}
    </p>
  );
}

function Status({ row }: { row: DraftRow }) {
  if (!row.status && !row.note) return null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2 font-normal">
      {row.status && <StatusPill status={row.status} />}
      {row.note && <span className="text-xs text-muted">{row.note}</span>}
    </span>
  );
}

function Entry({ v }: { v: VersionRow }) {
  const when = v.href
    ? <Link href={v.href} className="focus-ring rounded-sm hover:text-accent hover:underline">{v.submitted}</Link>
    : v.submitted;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <p className="min-w-0">
        <span className="font-mono text-xs text-muted">v{v.n}</span>
        <span className="mx-2 font-mono text-xs text-muted">{exhibit(v.id)}</span>
        <span className="text-muted">{when}</span>
        <Status row={v} />
      </p>
      <div className="flex items-center gap-2">
        {v.similarity && <ScoreBadge {...v.similarity} />}
        {v.ai && <AiBadge {...v.ai} />}
        <VersionActions a={v.actions} />
      </div>
    </li>
  );
}

export function PapersList({ papers }: { papers: PaperCard[] }) {
  return (
    <ul className="space-y-4">
      {papers.map((p) => {
        const newest = p.versions[p.versions.length - 1];
        const earlier = p.versions.slice(0, -1);
        const before = p.versions[p.versions.length - 2];
        return (
          // Keyed by the newest version too, so a paper that gains a version renders as new.
          <li key={`${p.id}-${newest.id}`} className="paper rounded-lg border border-border bg-bg">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <VersionStack count={p.versions.length} />
              <div className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                <ExhibitTitle id={newest.id} title={newest.title} href={newest.href} inline
                  below={(
                    <>
                      <span className="mt-0.5 block text-xs font-normal text-muted">
                        {p.versions.length > 1 ? `Version ${newest.n} of ${p.versions.length}, ` : ""}{newest.submitted}
                      </span>
                      <Status row={newest} />
                      {before && p.change && <Change from={before} change={p.change} />}
                    </>
                  )} />
              </div>
              <div className="flex items-center gap-2 max-sm:col-span-2">
                {newest.similarity && <ScoreBadge {...newest.similarity} />}
                {newest.ai && <AiBadge {...newest.ai} />}
                <VersionActions a={newest.actions} />
              </div>
            </div>
            {earlier.length > 0 && (
              <div className="rounded-b-lg border-t border-border bg-surface px-5 py-2">
                <h3 className="sr-only">Earlier versions of {newest.title}</h3>
                <ol className="divide-y divide-border">
                  {earlier.map((v) => <Entry key={v.id} v={v} />)}
                </ol>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// S03 drafts table (components.md: Data table). Stacks into cards below md.
import type { ReactNode } from "react";
import { AiBadge, ScoreBadge } from "./score";
import { ExhibitTitle, Skeleton, StatusPill } from "./ui";

// Badges and the title link are optional: a draft still being read, or rejected, has no report yet.
export type DraftRow = {
  id: number; title: string; submitted: string; href?: string;
  similarity?: Parameters<typeof ScoreBadge>[0]; ai?: Parameters<typeof AiBadge>[0];
  status?: Parameters<typeof StatusPill>[0]["status"]; note?: string; menu?: ReactNode;
};

export function DraftsTable({ rows, loading }: { rows: DraftRow[]; loading?: boolean }) {
  return (
    <div className="overflow-x-auto">
    <table className="w-full text-sm" aria-busy={loading || undefined}>
      <thead className="max-md:sr-only">
        <tr className="border-b border-border text-left text-xs font-semibold whitespace-nowrap uppercase tracking-wider text-muted">
          <th scope="col" className="py-3 pr-4 pl-4 font-semibold">Draft</th>
          <th scope="col" className="py-3 pr-4 font-semibold lg:max-xl:hidden">Submitted</th>
          <th scope="col" className="py-3 pr-4 font-semibold">Similarity</th>
          <th scope="col" className="py-3 pr-4 font-semibold">AI writing</th>
          <th scope="col" className="py-3 pr-4 font-semibold"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {loading
          ? [0, 1, 2].map((i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td colSpan={5} className="px-4 py-4"><Skeleton className="h-6 w-full" /></td>
              </tr>
            ))
          : rows.map((r) => (
              <tr key={r.id}
                className="border-b border-border transition-colors last:border-0 hover:bg-surface max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:px-4 max-md:py-4">
                {/* Status only appears when there is one: still being read, waiting, failed or rejected. */}
                <td className="py-3 pr-4 pl-4 font-semibold max-md:col-span-2 max-md:p-0">
                  <ExhibitTitle id={r.id} title={r.title} href={r.href} inline below={(r.status || r.note) && (
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 font-normal">
                      {r.status && <StatusPill status={r.status} />}
                      {r.note && <span className="text-xs text-muted">{r.note}</span>}
                    </span>
                  )} />
                </td>
                <td className="py-3 pr-4 whitespace-nowrap text-muted max-md:col-span-2 max-md:p-0 lg:max-xl:hidden">{r.submitted}</td>
                <td className="py-3 pr-4 max-md:p-0">{r.similarity && <ScoreBadge {...r.similarity} />}</td>
                <td className="py-3 pr-4 max-md:p-0">{r.ai && <AiBadge {...r.ai} />}</td>
                <td className="py-3 pr-4 text-right max-md:col-span-2 max-md:p-0 max-md:text-left">{r.menu}</td>
              </tr>
            ))}
      </tbody>
    </table>
    </div>
  );
}

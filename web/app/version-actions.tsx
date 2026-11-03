"use client";
// A version's row actions: retry a failed check, move it to another paper, delete it. Built here from
// plain data, so the papers list (a client component since it filters as you type) is handed data, not
// ready-made elements from the server, which React would re-check and warn about.
import { DeleteDraft } from "./delete-draft";
import { RetryButton } from "./retry-button";
import { VersionMenu } from "./version-menu";

export type VersionActionsData = {
  id: number; title: string; inChain: boolean;
  others: { id: number; title: string }[]; // papers it could join, most alike first
  retryReportId: number | null; // set when its similarity check failed
};

export function VersionActions({ a }: { a: VersionActionsData }) {
  return (
    <span className="inline-flex gap-1">
      {a.retryReportId !== null && <RetryButton reportId={a.retryReportId} title={a.title} />}
      <VersionMenu id={a.id} title={a.title} others={a.others} inChain={a.inChain} />
      <DeleteDraft id={a.id} title={a.title} />
    </span>
  );
}

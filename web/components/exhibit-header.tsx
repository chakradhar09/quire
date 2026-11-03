// Header of the report: the entry, and both readouts (similarity and AI writing). The two checks are
// layers of one report now, switched in the report's own toolbar. Server component.
import type { ReactNode } from "react";
import { listDrafts } from "@/lib/db";
import { Readout } from "./score";
import { ExhibitTitle } from "./ui";

export function ExhibitHeader({ documentId, title, meta }: { documentId: number; title: string; meta?: ReactNode }) {
  const d = listDrafts().find((x) => x.id === documentId);
  const simReady = d?.reportStatus === "done" || d?.reportStatus === "recalculating";
  const aiLow = d?.aiStatus === "done" && (d.aiScore ?? 0) > 0 && (d.aiScore ?? 0) < 20;
  const aiNote = d?.aiStatus === "unavailable" ? "Not available" : aiLow ? "Under 20%, not shown"
    : d?.aiStatus === "done" ? undefined : d?.aiStatus === "error" ? "Failed" : "Estimating";

  return (
    <header className="mb-4 border-b border-border">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3 pb-4">
        <div className="min-w-0 max-w-3xl">
          <ExhibitTitle id={documentId} title={title} as="h1" clamp className="text-lg text-balance md:text-xl" />
          {meta && <p className="mt-1.5 text-sm text-muted">{meta}</p>}
        </div>
        <div className="flex gap-10">
          <Readout tone="similarity" label="Similarity" current
            value={simReady ? d?.score ?? 0 : null} note={simReady ? undefined : d?.reportStatus === "error" ? "Failed" : "Checking"} />
          <Readout tone="ai" label="AI writing" current
            value={d?.aiStatus === "done" && !aiLow ? d.aiScore ?? 0 : null} note={aiNote} />
        </div>
      </div>
    </header>
  );
}

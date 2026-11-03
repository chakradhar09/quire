import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ExhibitHeader } from "@/components/exhibit-header";
import { AppHeader, Examination, InlineAlert, Skeleton } from "@/components/ui";
import { AiNotes } from "@/components/ai-notes";
import { Dismissible } from "@/components/dismissible";
import { figuresElsewhere, getAiReport, getReport, getResolutions } from "@/lib/db";
import { RetryButton } from "../../retry-button";
import { ReportView } from "./report-view";
import { WorkerLight } from "@/components/worker-light";

export const metadata: Metadata = { title: "Similarity report · Quire" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// S07: score, highlights, and the side panel. Refreshes itself until the check or a recalculation finishes.
async function Report({ params, searchParams }: PageProps<"/reports/[id]">) {
  await connection();
  const { id } = await params;
  const query = await searchParams;
  const report = /^\d+$/.test(id) ? getReport(Number(id)) : null;
  if (!report) notFound();
  const ready = report.status === "done" || report.status === "recalculating";
  const reused = figuresElsewhere(report.documentId);
  const ai = getAiReport(report.documentId);
  const aiRunning = ai?.status === "queued" || ai?.status === "processing";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AutoRefresh active={!ready || report.status === "recalculating" || aiRunning} />
      <ExhibitHeader documentId={report.documentId} title={report.title}
        meta={ready && report.generatedAt ? `Checked ${when(report.generatedAt)} with ${report.queriesUsed} web searches.` : undefined} />

      <div aria-live="polite" className="empty:hidden mb-4">
        {(report.status === "queued" || report.status === "processing") && (
          <div className="rounded-lg border border-border bg-bg p-6">
            <Examination steps={[
              { label: "Reading the file", state: "done" },
              { label: "Searching the web for matching passages", state: "active" },
              { label: "Ranking sources and scoring", state: "pending" },
            ]} note="This page updates by itself as soon as the check finishes." />
          </div>
        )}
        {report.status === "recalculating" && (
          <InlineAlert variant="info" title="Recalculating">
            Applying your filters and exclusions. The score updates in a moment.
          </InlineAlert>
        )}
        {report.status === "done" && report.sources.length === 0 && (
          <Dismissible id={`no-matches-${report.id}`}>
            <InlineAlert variant="success" title="No matching text found">
              None of the pages found share 8 or more words in a row with this draft.
            </InlineAlert>
          </Dismissible>
        )}
      </div>
      {report.status === "error" && (
        <InlineAlert variant="danger" title="This check failed">
          <p>{report.error ?? "No reason was recorded."}</p>
          <div className="mt-3"><RetryButton reportId={report.id} /></div>
        </InlineAlert>
      )}
      {reused.length > 0 && (
        <Dismissible id={`figures-${report.documentId}`} className="mb-4">
          <InlineAlert variant="info" title="Figures also in your other uploads">
            <p>Compared by picture on this PC, not searched on the web.</p>
            <ul className="mt-2 list-disc pl-5">
              {reused.map((f) => (
                <li key={`${f.figure}-${f.otherReportId}-${f.otherFigure}`}>
                  Figure {f.figure} is figure {f.otherFigure} in{" "}
                  {f.otherReportId ? <Link href={`/reports/${f.otherReportId}`}>{f.otherTitle}</Link> : f.otherTitle}
                </li>
              ))}
            </ul>
          </InlineAlert>
        </Dismissible>
      )}
      {ready && <AiNotes ai={ai} />}
      {ready && (
        <ReportView report={report} ai={ai} resolutions={getResolutions(report.documentId)}
          panel={one(query.panel)} match={one(query.match)} layers={one(query.layers)} />
      )}
    </div>
  );
}

export default function ReportPage(props: PageProps<"/reports/[id]">) {
  return (
    <>
      <AppHeader current="drafts" status={<Suspense><WorkerLight /></Suspense>} />
      <main id="main" className="mx-auto flex w-full max-w-content-max flex-col px-4 py-4 md:px-8 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">
        <Suspense fallback={<div className="space-y-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-96 w-full" /></div>}>
          <Report {...props} />
        </Suspense>
      </main>
    </>
  );
}

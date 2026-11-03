import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { listDrafts } from "@/lib/db";

// The AI writing report is a layer of the draft's one report now; old links land there with both layers on.
// Only a redirect, so nothing to stream: it may block on the database (cacheComponents would otherwise
// refuse to prerender a page that reads it outside <Suspense>).
export const instant = false;

export default async function AiReportPage({ params }: PageProps<"/documents/[id]/ai">) {
  await connection();
  const { id } = await params;
  const draft = /^\d+$/.test(id) ? listDrafts().find((d) => d.id === Number(id)) : undefined;
  if (!draft || draft.reportId === null) notFound();
  redirect(`/reports/${draft.reportId}?layers=sim,ai`);
}

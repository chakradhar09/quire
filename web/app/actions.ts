"use server";
import { revalidatePath } from "next/cache";
import { paperFromField } from "@/lib/upload";
import { braveKeyError, writeSettings } from "@/lib/settings";
import { stopQuire } from "@/lib/alive";
import { redirect } from "next/navigation";
import {
  deleteDocument, moveToPaper, retryReport, setMatchExcluded, setResolution, setSourceExcluded, submitText, updateReportSettings, type ReportSettings,
} from "@/lib/db";

// What S04 shows after a refused paste: the message, and the text back so nothing is lost.
export type PasteState = { error?: string; title?: string; text?: string };

export async function submitPaste(_prev: PasteState, form: FormData): Promise<PasteState> {
  const title = String(form.get("title") ?? "");
  const text = String(form.get("text") ?? "");
  const result = submitText(title, text, undefined, paperFromField(form.get("paper")));
  if ("error" in result) return { error: result.error, title, text };
  revalidatePath("/drafts");
  redirect("/drafts");
}

export async function setAutoUpdate(on: boolean) {
  writeSettings({ autoUpdate: on === true });
  revalidatePath("/settings");
}

// The Settings page's key form. Empty `remove` saves; "remove" clears the key. Returns the problem, if any.
export async function saveBraveKey(_prev: { error?: string; saved?: boolean }, form: FormData) {
  if (form.get("remove") === "1") {
    writeSettings({ braveApiKey: "" });
  } else {
    const key = String(form.get("key") ?? "");
    const error = braveKeyError(key);
    if (error) return { error };
    writeSettings({ braveApiKey: key.trim() });
  }
  revalidatePath("/settings");
  revalidatePath("/drafts");
  return { saved: true };
}

// The Settings page's Stop button: the app and the worker, now.
export async function stop() {
  stopQuire({ worker: true });
}

export async function deleteDraft(id: number) {
  deleteDocument(Number(id));
  revalidatePath("/drafts");
}

// Put a version into another paper (any draft of it names the paper) or, with null, start its own.
// False when the move was refused, e.g. into its own chain.
export async function movePaper(id: number, paper: number | null) {
  const moved = moveToPaper(Number(id), paper === null ? null : Number(paper));
  revalidatePath("/drafts");
  return moved;
}

// Report changes refresh both the report and the drafts list, whose badge shows the same score.
function changed(reportId: number) {
  revalidatePath("/drafts");
  revalidatePath(`/reports/${reportId}`);
}

export async function retry(reportId: number) {
  retryReport(Number(reportId));
  changed(reportId);
}

export async function saveFilters(reportId: number, settings: ReportSettings) {
  const result = updateReportSettings(Number(reportId), {
    excludeQuotes: Boolean(settings.excludeQuotes),
    excludeBibliography: Boolean(settings.excludeBibliography),
    smallMatchWords: Number(settings.smallMatchWords),
  });
  changed(reportId);
  return result;
}

export async function excludeSource(reportId: number, sourceId: number, excluded: boolean) {
  setSourceExcluded(Number(reportId), Number(sourceId), Boolean(excluded));
  changed(reportId);
}

// Record what was decided about a flagged passage (state null undoes it). Excluding a match is not a
// resolution: it goes through excludeMatch because it changes the score.
export async function resolve(reportId: number, documentId: number, kind: "match" | "ai", start: number, end: number,
  state: "cited" | "rewritten" | "kept" | null) {
  if (kind !== "match" && kind !== "ai") return;
  if (state !== null && state !== "cited" && state !== "rewritten" && state !== "kept") return;
  const [s, e] = [Number(start), Number(end)];
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s) return;
  setResolution(Number(documentId), kind, s, e, state);
  revalidatePath(`/reports/${Number(reportId)}`);
}

export async function excludeMatch(reportId: number, matchId: number, excluded: boolean) {
  setMatchExcluded(Number(reportId), Number(matchId), Boolean(excluded));
  changed(reportId);
}

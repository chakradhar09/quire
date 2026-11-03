// The checking queue as the owner sees it: which drafts are still being read or checked, and where each
// one has got to. Shared by the header's queue button and anything else that shows progress.
import type { Draft } from "./db.ts";

export type StepState = "done" | "active" | "pending" | "failed" | "skipped";

// Still moving: being read, or either check not finished.
export const unfinished = (d: Draft) =>
  d.status === "extracting" || (d.status === "ready" && (
    (d.reportStatus !== "done" && d.reportStatus !== "error") || d.aiStatus === "queued" || d.aiStatus === "processing"));

// The three things that happen to a draft, in order, with where this one has got to.
export function queueSteps(d: Draft): { label: string; state: StepState }[] {
  const read: StepState = d.status === "extracting" ? "active" : "done";
  const sim: StepState = d.status === "extracting" ? "pending"
    : d.reportStatus === "done" ? "done" : d.reportStatus === "error" ? "failed" : "active";
  const ai: StepState = d.status === "extracting" ? "pending"
    : d.aiStatus === "done" ? "done" : d.aiStatus === "unavailable" ? "skipped" : d.aiStatus === "error" ? "failed" : "active";
  return [
    { label: "Reading the file", state: read },
    { label: "Searching the web for matching passages", state: sim },
    { label: "Estimating AI writing", state: ai },
  ];
}

// One line for a preview: the step running now, or that the worker is not picking the draft up.
export const currentStep = (d: Draft) =>
  d.waiting ? "Waiting for the worker" : queueSteps(d).find((s) => s.state === "active")?.label ?? "Finishing";

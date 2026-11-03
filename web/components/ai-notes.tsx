// What to know about the AI writing estimate, shown with the report: it is an estimate, how it was
// calibrated, and why there may be none. Server component.
import type { AiReportView } from "@/lib/db";
import { Dismissible } from "./dismissible";
import { InlineAlert } from "./ui";

const UNAVAILABLE = {
  too_few_words: "This draft has fewer than 300 words of prose. Below that the estimate means nothing, so none is given.",
  unsupported_language: "This draft isn't in English, and the model is only checked on English writing.",
};

function Calibration({ c }: { c: AiReportView["calibration"] }) {
  if (c?.calibrated) {
    // The classifier's threshold is set on student essays and academic papers together, and its detection
    // rate is measured on the newest AI models it was never trained on (T13 follow-up).
    const classifier = c.detector === "classifier";
    const rate = c.falsePositiveRate === undefined ? ""
      : `: at this setting ${(c.falsePositiveRate * 100).toFixed(1)}% of their passages were wrongly flagged`;
    const caught = c.detectionRate === undefined ? null
      : classifier
        ? `It caught ${Math.round(c.detectionRate * 100)}% of passages from the newest AI models it was tested on, so a low score does not mean a human wrote it.`
        : `It flagged ${Math.round(c.detectionRate * 100)}% of the AI-written test essays, so a low score does not mean a human wrote it.`;
    return (
      <div className="space-y-1 text-sm text-muted">
        <p>Calibrated on {classifier ? "student essays and academic papers" : "PERSUADE 2.0 student essays"}{rate}.</p>
        {caught && <p>{caught}</p>}
      </div>
    );
  }
  return (
    <InlineAlert variant="warning" title="Uncalibrated">
      The threshold hasn&apos;t been tested on real essays yet, so treat this number as rough.
    </InlineAlert>
  );
}

export function AiNotes({ ai }: { ai: AiReportView | null }) {
  const score = ai?.score ?? 0;
  const done = ai?.status === "done";
  return (
    <div className="mb-3 space-y-2 text-sm">
      <Dismissible id="ai-note" className="space-y-2">
      <p className="text-muted">
        <span className="font-semibold text-text">The AI writing number is an estimate, not proof.</span>{" "}
        It comes from an open model and is wrong in both directions: human writing can be flagged and AI writing missed.
      </p>
      {done && (
        <details className="text-muted">
          <summary className="focus-ring cursor-pointer rounded-sm text-xs font-semibold">How the AI estimate was calibrated</summary>
          <div className="mt-2">
            {ai?.qualifyingWords != null && <p className="mb-1 text-sm">Based on {ai.qualifyingWords} words of prose. Lists, headings and the reference list are left out.</p>}
            <Calibration c={ai?.calibration ?? null} />
          </div>
        </details>
      )}
      </Dismissible>
      {ai?.status === "unavailable" && (
        <Dismissible id={`ai-unavailable-${ai.documentId}`}>
          <InlineAlert variant="warning" title="No AI estimate for this draft">{UNAVAILABLE[ai.unavailableReason ?? "too_few_words"]}</InlineAlert>
        </Dismissible>
      )}
      {ai?.status === "error" && <InlineAlert variant="danger" title="The AI estimate failed">{ai.error ?? "No reason was recorded."}</InlineAlert>}
      {done && score > 0 && score < 20 && (
        <p><span className="font-semibold">*</span> Under 20%. Low estimates are the least reliable, so the number and the highlights are not shown.</p>
      )}
      {done && score === 0 && <p>No passage read as machine-written.</p>}
    </div>
  );
}

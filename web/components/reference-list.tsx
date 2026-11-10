// The report's References tab: each entry of the draft's reference list and whether OpenAlex or Crossref has
// a work with the title it cites. Not finding one is a prompt to check, not proof the work doesn't exist: small
// journals, books and reports are often in neither.
import { CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import type { ReferenceCheck } from "@/lib/db";

const ICON = {
  found: { Icon: CircleCheck, className: "text-success", label: "Found" },
  not_found: { Icon: TriangleAlert, className: "text-warning", label: "Not found" },
  no_title: { Icon: CircleHelp, className: "text-muted", label: "No title read" },
} as const;

export function ReferenceList({ text, references }: { text: string; references: ReferenceCheck[] }) {
  const found = references.filter((r) => r.status === "found").length;
  const missing = references.filter((r) => r.status === "not_found").length;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{found} of {references.length} found in OpenAlex or Crossref</p>
        <p className="text-xs text-muted">
          {missing > 0
            ? "Check the ones not found: the title may be mistyped, or the work may not exist. Small journals, books and reports are often in neither catalogue."
            : "Each cited title matches a work in a catalogue of published research."}
        </p>
      </div>
      <ol aria-label="Reference list">
        {references.map((r, i) => {
          const { Icon, className, label } = ICON[r.status];
          const entry = text.slice(r.start, r.end).replace(/^\s*(\[\d+\]|\d+[.)])\s*/, "");
          return (
            <li key={r.start} className="flex gap-3 border-b border-border py-3 last:border-0">
              <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${className}`} />
              <div className="min-w-0 space-y-1 text-sm">
                <p className="[overflow-wrap:anywhere]">
                  <span className="sr-only">{label}: </span>
                  <span className="font-mono text-xs text-muted">{i + 1}.</span> {r.title ?? entry.slice(0, 160)}
                </p>
                {r.status === "found" && r.foundUrl ? (
                  <a href={r.foundUrl} target="_blank" rel="noreferrer"
                    title={r.foundTitle ?? undefined}
                    className="focus-ring block rounded-sm text-xs text-accent underline [overflow-wrap:anywhere]">
                    Found{r.foundYear ? `, ${r.foundYear}` : ""} · {r.foundUrl.replace(/^https?:\/\//, "")}
                  </a>
                ) : r.status === "not_found" ? (
                  <p className="text-xs text-muted">Not found in OpenAlex or Crossref.</p>
                ) : r.status === "no_title" ? (
                  <p className="text-xs text-muted">Quire couldn&apos;t read a title from this entry, so it wasn&apos;t looked up.</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

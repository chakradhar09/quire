// Score badges (components.md: Scores). Both are links to their report.
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AI_BADGE_CLASS, AI_TEXT_CLASS, BAND_CLASS, aiBand, band } from "@/lib/report.ts";
import { cx } from "./ui";

type State = "pending" | "done" | "error" | "recalculating";

const BADGE = "focus-ring inline-flex items-center justify-center gap-1.5 rounded-sm font-mono font-medium tabular-nums transition-[filter] hover:brightness-95";

export function ScoreBadge({ score, state = "done", href, size = "sm" }: { score?: number; state?: State; href: string; size?: "sm" | "lg" }) {
  const known = score !== undefined && state !== "pending" && state !== "error";
  const colour = known ? BAND_CLASS[band(score)] : "bg-surface-sunken text-muted";
  const shown = state === "pending" ? "--" : state === "error" ? "!" : `${Math.round(score ?? 0)}%`;
  const name =
    state === "pending" ? "Similarity check in progress" :
    state === "error" ? "Similarity check failed, open report" :
    `Similarity ${shown}${state === "recalculating" ? ", recalculating" : ""}, open report`;
  return (
    <Link href={href} aria-label={name}
      className={cx(BADGE, size === "lg" ? "px-3 py-1 text-xl" : "h-7 min-w-14 px-2 text-sm", colour)}>
      <span aria-hidden className={state === "recalculating" ? "opacity-60" : undefined}>
        {shown}
      </span>
      {state === "recalculating" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
    </Link>
  );
}

type AiState = "pending" | "done" | "unavailable" | "error";

export function AiBadge({ score, state = "done", reason, href }: { score?: number; state?: AiState; reason?: string; href: string }) {
  const shownScore = Math.round(score ?? 0); // thresholds follow the number shown, like the bands
  const low = state === "done" && score !== undefined && shownScore > 0 && shownScore < 20;
  const shown = state === "pending" ? "--" : state === "error" ? "!" : state === "unavailable" ? "n/a" : low ? "*" : `${Math.round(score ?? 0)}%`;
  const name =
    state === "pending" ? "AI writing estimate in progress" :
    state === "error" ? "AI writing estimate failed" :
    state === "unavailable" ? `AI writing estimate not available: ${reason ?? "unknown reason"}` :
    low ? "AI writing estimate under 20%, not shown, open AI report" :
    `AI writing estimate ${shown}, open AI report`;
  const muted = state !== "done" || low;
  const warn = !muted && aiBand(shownScore) !== "low";
  return (
    <Link href={href} aria-label={name} title={state === "unavailable" ? reason : low ? "Under 20%: too unreliable to show" : undefined}
      className={cx(BADGE, "h-7 min-w-16 px-2 text-sm", muted ? "bg-surface-sunken text-muted" : AI_BADGE_CLASS[aiBand(score ?? 0)])}>
      <span aria-hidden className={cx("font-sans text-xs font-bold", muted ? "text-muted" : warn ? "text-current" : "text-ai-solid")}>AI</span>
      <span aria-hidden>{shown}</span>
    </Link>
  );
}

// Report header readout: the large number for one check, with what it measures underneath.
export function Readout({ label, value, href, current, tone, note }: {
  label: string; value: number | null; href?: string; current?: boolean; tone: "similarity" | "ai"; note?: string;
}) {
  const body = (
    <>
      <span className={cx("block font-mono text-readout tracking-tight", tone === "ai" ? AI_TEXT_CLASS[aiBand(value ?? 0)] : "text-text")}>
        {value === null ? <span className="text-muted">--</span> : `${Math.round(value)}%`}
      </span>
      <span className="mt-1 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {note && <span className="block text-xs text-muted">{note}</span>}
    </>
  );
  return href && !current
    ? <Link href={href} className="focus-ring block rounded-sm text-right transition-opacity hover:opacity-80">{body}</Link>
    : <div className="text-right">{body}</div>;
}

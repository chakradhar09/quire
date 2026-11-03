"use client";
// Report parts (components.md: Report). Presentational: selection state comes from the caller.
import type { CSSProperties } from "react";
import { BookOpen, EyeOff, Globe, Library, Replace } from "lucide-react";
import { matchColour, paragraphs, segments, type LayoutBlock, type Range, type Span } from "@/lib/report.ts";
import { dotSize, matchVars } from "./evidence";
import { Button, cx } from "./ui";

// resolved: the owner has decided about this passage; it stays marked, struck once and lighter.
export type ViewerSpan = Span & { label: string; kind?: "match" | "ai" | "ai-paraphrased" | "excluded"; resolved?: boolean };

const KIND_VARS = {
  ai: { tint: "var(--ai-bg)", line: "var(--ai-solid)" },
  "ai-paraphrased": { tint: "var(--ai-paraphrased-bg)", line: "var(--ai-paraphrased-solid)" },
};

// Word's look for each paragraph kind in a layout (a DOCX); headings are sans like Word's defaults.
const BLOCK_CLASS = {
  title: "mb-6 font-sans text-2xl font-semibold",
  h1: "mt-8 mb-4 font-sans text-xl font-semibold",
  h2: "mt-6 mb-3 font-sans text-lg font-semibold",
  h3: "mt-5 mb-2 font-sans font-semibold",
  h4: "mt-4 mb-2 font-sans font-semibold italic",
  p: "mb-5",
  li: "relative mb-2 pl-6 before:absolute before:left-1 before:content-['•']",
  caption: "mb-5 text-sm text-muted",
};
const HEADING_TAG = { title: "p", h1: "h3", h2: "h4", h3: "h5", h4: "h6" } as const;

// ---------------------------------------------------------------- Document viewer + highlights
// layout (a DOCX): headings, lists, tables and pictures as written; without one, plain paragraphs.
// Highlights cut by offset either way, so both show the same marks.
export function DocumentViewer({ title, text, spans, selectedId, onSelect, bibliographyStart, layout, media }: {
  title: string; text: string; spans: ViewerSpan[]; selectedId?: string; onSelect?: (id: string) => void; bibliographyStart?: number;
  layout?: LayoutBlock[] | null; media?: string;
}) {
  const segs = segments(text.length, spans);
  const seen = new Set<string>();

  // text[ps, pe) with its highlights; the first piece of each match carries its numbered chip.
  const piece = ([ps, pe]: Range) => segs.filter((s) => s.end > ps && s.start < pe).map((s) => {
    const a = Math.max(s.start, ps);
    const b = Math.min(s.end, pe);
    const chunk = text.slice(a, b);
    const span = s.span as ViewerSpan | null;
    if (!span) return <span key={a}>{chunk}</span>;
    const first = !seen.has(span.id);
    seen.add(span.id);
    const kind = span.kind ?? "match";
    const c = matchColour(span.rank);
    const selected = span.id === selectedId;
    const vars = kind === "match" ? matchVars(span.rank) : kind === "excluded" ? null : KIND_VARS[kind];
    const style = (vars ? { "--tint": vars.tint, "--line": vars.line } : undefined) as CSSProperties | undefined;
    return (
      <mark key={a} id={first ? `m-${span.id}` : undefined} data-span={span.id} aria-current={selected || undefined} style={style}
        className={cx("ev scroll-mt-24 bg-transparent text-inherit",
          kind === "excluded" && "ev-excluded text-muted", span.resolved && "ev-resolved",
          selected && `outline-2 outline-offset-2 ${kind === "match" ? c.ring : "outline-focus"}`)}>
        {first && kind === "match" && (
          <button type="button" onClick={() => onSelect?.(span.id)} aria-label={span.label}
            className={cx("focus-ring mr-1 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded-sm px-1 align-middle font-mono text-[11px] font-semibold text-on-match", c.chip)}>
            {span.rank}
          </button>
        )}
        <span onClick={() => onSelect?.(span.id)} className={onSelect && "cursor-pointer"}>{chunk}</span>
      </mark>
    );
  });
  const marked = ([ps, pe]: Range) => segs.some((s) => s.span && s.end > ps && s.start < pe);
  const bibTop = (ps: number) => bibliographyStart !== undefined && ps === bibliographyStart && "mt-10 border-t border-border pt-8";
  const lines = (rs: Range[]) => rs.map((r) => <p key={r[0]} className="mb-1 last:mb-0">{piece(r)}</p>);

  const block = (b: LayoutBlock, i: number) => {
    switch (b.t) {
      case "table":
        return (
          <div key={i} className="mb-6 overflow-x-auto">
            <table className="w-full border-collapse font-sans text-sm">
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell) => (
                      <td key={cell.r[0]} colSpan={cell.span} className="border border-border px-2 py-1 align-top whitespace-pre-line">
                        {piece(cell.r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "img":
        return (
          <figure key={i} className="my-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- the draft's own picture, served as stored */}
            <img src={`${media}/${b.src}`} alt={`Picture ${b.n} in the draft`} loading="lazy"
              style={b.w ? { width: b.w } : undefined} className="mx-auto h-auto max-w-full" />
            {b.ocr.length > 0 && (
              <details open={b.ocr.some(marked)} className="mt-2 font-sans text-sm">
                <summary className="focus-ring cursor-pointer rounded-sm text-xs text-muted">Text read from this picture</summary>
                <div className="mt-2 rounded-sm bg-surface px-3 py-2">{lines(b.ocr)}</div>
              </details>
            )}
          </figure>
        );
      case "box":
        return <aside key={i} className="mb-5 rounded-sm border border-border px-4 py-3 text-sm">{lines(b.lines)}</aside>;
      case "chart":
        return (
          <figure key={i} className="mb-5 rounded-sm border border-dashed border-border-input px-4 py-3 font-sans text-sm">
            <figcaption className="mb-1 text-xs text-muted">Chart</figcaption>
            {lines(b.lines)}
          </figure>
        );
      default: {
        if (b.r[0] === b.r[1]) return null; // an empty paragraph Word uses for spacing
        const Tag = b.t in HEADING_TAG ? HEADING_TAG[b.t as keyof typeof HEADING_TAG] : "p";
        return (
          <Tag key={i} className={cx(BLOCK_CLASS[b.t], "whitespace-pre-line", b.align === "center" && "text-center",
            b.align === "right" && "text-right", bibTop(b.r[0]))}>
            {piece(b.r)}
          </Tag>
        );
      }
    }
  };

  return (
    <div className="quad p-3 md:p-8">
      <article aria-labelledby="doc-title" className="sheet md:margin-rule relative mx-auto max-w-paper overflow-hidden rounded-sm px-6 py-8 font-serif text-doc md:px-16 md:py-14">
        <h2 id="doc-title" className="mb-8 font-sans text-xl">{title}</h2>
        {layout ? layout.map(block) : paragraphs(text).map((r) => (
          <p key={r[0]} className={cx("mb-5", bibTop(r[0]))}>{piece(r)}</p>
        ))}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------- Source card (ledger row)
const SOURCE_TYPE = {
  internet: { Icon: Globe, label: "Web page" },
  publication: { Icon: BookOpen, label: "Publication" },
  library: { Icon: Library, label: "My library" },
};

// rank null: the source counts for nothing (a better source claimed its words, or filters hid them).
export function SourceCard({ rank, percent, type, title, host, words, selected, excluded, busy, onSelect, onToggleExclude }: {
  rank: number | null; percent: number; type: keyof typeof SOURCE_TYPE; title: string; host: string; words: number;
  selected?: boolean; excluded?: boolean; busy?: boolean; onSelect?: () => void; onToggleExclude?: () => void;
}) {
  const counted = rank !== null && !excluded;
  const { Icon, label } = SOURCE_TYPE[type];
  const name = rank === null ? title : `Source ${rank}`;
  const d = counted ? dotSize(percent) : 8;
  return (
    <li className={cx("grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-0", selected && "bg-surface", !counted && "text-muted")}>
      <span aria-hidden style={{ width: d, height: d, ...(counted && { background: matchVars(rank).line }) }}
        className={cx("justify-self-center rounded-pill", !counted && "border border-border-input")} />
      <div className="min-w-0">
        {onSelect ? (
          <button type="button" onClick={onSelect} aria-pressed={selected}
            className="focus-ring block w-full truncate rounded-sm text-left text-sm font-semibold hover:text-accent">
            {rank !== null && <span className="mr-1.5 font-mono text-xs text-muted">{rank}</span>}{title}
          </button>
        ) : <p className="truncate text-sm font-semibold">{rank !== null && <span className="mr-1.5 font-mono text-xs text-muted">{rank}</span>}{title}</p>}
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
          <Icon aria-hidden className="size-3.5 shrink-0" /> {label} · {host} · {words} words
        </p>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-lg font-medium tabular-nums">{excluded ? "–" : `${percent}%`}</span>
        <Button variant="ghost" size="sm" className="-mr-2 h-6 px-2 text-xs text-muted" onClick={onToggleExclude} loading={busy}
          aria-label={`${excluded ? "Restore" : "Exclude"} ${name}`}>
          {excluded ? "Restore" : "Exclude"}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- Match group card
export const GROUPS = {
  not_cited_or_quoted: "No quote, no citation",
  missing_quotation: "Cited but not quoted",
  missing_citation: "Quoted but not cited",
  cited_and_quoted: "Quoted and cited",
};

export function MatchGroupCard({ group, count, percent, selected, onToggle }: {
  group: keyof typeof GROUPS; count: number; percent: number; selected?: boolean; onToggle?: () => void;
}) {
  return (
    <button type="button" disabled={count === 0} aria-pressed={selected} onClick={onToggle}
      aria-label={`${GROUPS[group]}: ${count} matches, ${percent}%`}
      className={cx("focus-ring flex w-full items-center justify-between rounded-md border bg-bg px-4 py-3 text-left transition-colors",
        selected ? "border-accent" : "border-border", count === 0 ? "text-muted" : "hover:bg-surface")}>
      <span className="text-sm font-semibold">{GROUPS[group]}</span>
      <span className="text-right">
        <span className="block font-mono text-lg">{count}</span>
        <span className="block text-xs text-muted">{percent}%</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- Flag card
const FLAG = {
  hidden_text: { Icon: EyeOff, title: "Hidden text", body: "Text that is white, tiny or hidden in the file. It still counts." },
  replaced_characters: { Icon: Replace, title: "Swapped characters", body: "Letters from another alphabet that look like Latin ones." },
};

export function FlagCard({ type, count, snippet, onShow }: { type: keyof typeof FLAG; count: number; snippet: string; onShow?: () => void }) {
  const { Icon, title, body } = FLAG[type];
  return (
    <div className="rounded-md bg-warning-surface px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-warning"><Icon aria-hidden className="size-4" /> {title} ({count})</p>
      <p className="mt-1">{body}</p>
      <p className="mt-2 rounded-sm bg-bg px-2 py-1 font-mono text-xs">{snippet}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onShow}>Show in draft</Button>
    </div>
  );
}

// ---------------------------------------------------------------- Split comparison pane
// Two fields side by side, like a comparison microscope, once the pane itself is wide enough (a container query).
// Previous / Next are disabled when their handler is missing (first or last match).
export function SplitCompare({ rank, position, draft, source, sourceTitle, url, excluding, onPrev, onNext, onExclude }: {
  rank: number; position?: string; draft: [string, string, string]; source: [string, string, string]; sourceTitle: string; url?: string;
  excluding?: boolean; onPrev?: () => void; onNext?: () => void; onExclude?: () => void;
}) {
  const v = matchVars(rank);
  const passage = ([before, hit, after]: [string, string, string]) => (
    <p className="font-serif text-base leading-7">
      {before}<mark key={hit} className="ev bg-transparent text-inherit" style={{ "--tint": v.tint, "--line": v.line } as CSSProperties}>{hit}</mark>{after}
    </p>
  );
  return (
    <section aria-label={`${position ? `Match ${position}` : "Match"} compared with source ${rank}`} className="@container rounded-lg border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="size-2.5 shrink-0 rounded-pill" style={{ background: v.line }} />
          <span className="truncate">Source {rank}: {sourceTitle}</span>
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onPrev} disabled={!onPrev}>Previous</Button>
          <Button variant="ghost" size="sm" onClick={onNext} disabled={!onNext}>Next</Button>
          <Button variant="secondary" size="sm" className="whitespace-nowrap" onClick={onExclude} loading={excluding}>Exclude match</Button>
        </div>
      </div>
      {position && <p className="px-4 pt-3 font-mono text-xs text-muted">Match {position}</p>}
      <div className="grid @md:grid-cols-2 @md:divide-x divide-border">
        <div className="p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Your draft</p>{passage(draft)}</div>
        <div className="border-t border-border p-4 @md:border-t-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="focus-ring underline">Source (opens in a new tab)</a> : "Source (saved copy)"}
          </p>
          {passage(source)}
        </div>
      </div>
    </section>
  );
}

"use client";
// S07 body: the paper and its side panel. Sources (S08, with S10 compare and S12 Excluded) and
// Filters (S11). The open tab and the selected match live in the URL (?panel=, ?match=).
import { useEffect, useEffectEvent, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import { PanelTabs, Switch } from "@/components/overlays";
import { matchVars } from "@/components/evidence";
import { PadPane, type PadTick } from "@/components/pad-scrollbar";
import { DocumentViewer, SourceCard, SplitCompare, type ViewerSpan } from "@/components/report";
import { ResolveList } from "@/components/resolve-list";
import { Button, TextField, cx } from "@/components/ui";
import type { AiReportView, ReportMatch, ReportSettings, ReportView as Report, Resolution, ResolutionState } from "@/lib/db";
import { buildItems, decide, keyOf, progress, step, type Decision, type Item } from "@/lib/resolve.ts";
import { excludeMatch, excludeSource, resolve, saveFilters } from "../../actions";

const CONTEXT = 150;

// [before, match, after] of the draft, with an ellipsis where the context was cut.
function draftPassage(text: string, m: ReportMatch): [string, string, string] {
  const from = Math.max(0, m.start - CONTEXT);
  const to = Math.min(text.length, m.end + CONTEXT);
  return [(from > 0 ? "…" : "") + text.slice(from, m.start), text.slice(m.start, m.end), text.slice(m.end, to) + (to < text.length ? "…" : "")];
}

const sourcePassage = ([before, hit, after]: [string, string, string]): [string, string, string] =>
  [(before.length === CONTEXT ? "…" : "") + before, hit, after + (after.length === CONTEXT ? "…" : "")];

const firstWords = (s: string) => s.split(/\s+/).slice(0, 8).join(" ") + "…";
const snippet = (s: string, words: number) => {
  const w = s.trim().split(/\s+/);
  return w.length > words ? `${w.slice(0, words).join(" ")}…` : w.join(" ");
};

export function ReportView({ report, ai, resolutions, panel: initialPanel, match: initialMatch, layers: initialLayers }: {
  report: Report; ai: AiReportView | null; resolutions: Resolution[]; panel?: string; match?: string; layers?: string;
}) {
  // The AI layer exists only for a finished estimate of 20% or more (under that the highlights are not shown).
  const aiUsable = ai?.status === "done" && (ai.score ?? 0) >= 20;
  const aiNote = !ai ? "Not checked" : ai.status === "unavailable" ? "Not available" : ai.status === "error" ? "Failed"
    : ai.status !== "done" ? "Estimating" : (ai.score ?? 0) < 20 ? "Under 20%, not shown" : undefined;

  const [layers, setLayers] = useState({
    sim: initialLayers === undefined || initialLayers.split(",").includes("sim"),
    ai: aiUsable && (initialLayers === undefined || initialLayers.split(",").includes("ai")),
  });
  const [panel, setPanel] = useState(initialPanel === "filters" || initialPanel === "sources" ? initialPanel : "resolve");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialMatch);
  const [activeKey, setActiveKey] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [pending, startTransition] = useTransition();
  const aside = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // What the owner decided, applied at once and confirmed when the server answers.
  const [matches, setMatchExcluded] = useOptimistic(report.matches, (cur, a: { id: number; excluded: boolean }) =>
    cur.map((m) => (m.id === a.id ? { ...m, excluded: a.excluded } : m)));
  const [saved, setSaved] = useOptimistic(resolutions, (cur, a: { kind: "match" | "ai"; start: number; end: number; state: ResolutionState | null }) => {
    const rest = cur.filter((r) => !(r.kind === a.kind && r.start === a.start && r.end === a.end));
    return a.state === null ? rest : [...rest, { kind: a.kind, start: a.start, end: a.end, state: a.state, at: "" }];
  });

  const aiSegments = useMemo(() => (aiUsable && ai ? ai.segments : []), [aiUsable, ai]);
  const items = useMemo(() => buildItems({ matches, ai: aiSegments, resolutions: saved })
    .filter((i) => (i.kind === "match" ? layers.sim : layers.ai)), [matches, aiSegments, saved, layers]);
  const { done, total } = progress(items);
  const spanIdOf = (i: Item) => (i.kind === "ai" ? `ai:${i.start}` : String(i.matchId));

  const text = report.text;
  const sourceOf = new Map(report.sources.map((s) => [s.sourceId, s]));
  const visible = matches.filter((m) => m.rank !== null && m.hidden === null && !m.excluded);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("panel", panel);
    if (selectedId) url.searchParams.set("match", selectedId);
    else url.searchParams.delete("match");
    url.searchParams.set("layers", [layers.sim && "sim", layers.ai && "ai"].filter(Boolean).join(",") || "none");
    window.history.replaceState(null, "", url);
  }, [panel, selectedId, layers]);

  // Bring a passage to the upper third of the document pane and pulse it once.
  const reveal = (spanId: string) => {
    const pane = scroller.current;
    if (!pane) return;
    const marks = [...pane.querySelectorAll<HTMLElement>(`[data-span="${CSS.escape(spanId)}"]`)];
    if (!marks.length) return;
    const box = pane.getBoundingClientRect();
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    pane.scrollTo({ top: pane.scrollTop + marks[0].getBoundingClientRect().top - box.top - box.height / 3, behavior: smooth ? "smooth" : "auto" });
    for (const m of marks) {
      m.classList.remove("ev-pulse");
      void m.offsetWidth; // restart the animation
      m.classList.add("ev-pulse");
      m.addEventListener("animationend", () => m.classList.remove("ev-pulse"), { once: true });
    }
  };

  const focusItem = (item: Item) => {
    setActiveKey(item.key);
    setSelectedId(spanIdOf(item));
    reveal(spanIdOf(item));
  };
  const focusBySpan = (spanId: string) => {
    const item = items.find((i) => spanIdOf(i) === spanId);
    if (!item) return;
    setPanel("resolve");
    focusItem(item);
  };
  // Compare a match with its source: the Sources tab, with the match selected.
  const select = (id: string | undefined) => {
    setSelectedId(id);
    setPanel("sources");
    if (id) aside.current?.scrollIntoView({ block: "nearest" }); // below lg the panel sits under the paper
  };

  const act = (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    startTransition(async () => {
      await fn();
      setBusy(undefined);
    });
  };
  const decideItem = (item: Item, d: Decision) => {
    if (d !== null && item.state === "excluded") return;
    if (item.kind === "match" && (d === "excluded" || (d === null && item.state === "excluded"))) {
      const excluded = d === "excluded";
      startTransition(async () => {
        setMatchExcluded({ id: item.matchId as number, excluded });
        await excludeMatch(report.id, item.matchId as number, excluded);
      });
      return;
    }
    if (d === "excluded") return;
    startTransition(async () => {
      setSaved({ kind: item.kind, start: item.start, end: item.end, state: d });
      await resolve(report.id, report.documentId, item.kind, item.start, item.end, d);
    });
    // After deciding, move on to the next passage so a run of decisions needs no mouse.
    if (d !== null) {
      const next = step(items, item.key, 1);
      const nextItem = items.find((i) => i.key === next);
      if (nextItem && next !== item.key) focusItem(nextItem);
    }
  };

  // Keyboard: j and k move through the list; c, r, e, p and z decide about the active passage.
  // An Effect Event: it sees the latest items and active passage without re-adding the listener.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) return;
    const k = e.key.toLowerCase();
    if (k === "j" || k === "k") {
      const key = step(items, activeKey, k === "j" ? 1 : -1);
      const item = items.find((i) => i.key === key);
      if (item) { e.preventDefault(); focusItem(item); }
      return;
    }
    const item = items.find((i) => i.key === activeKey);
    const d = item && decide(k, item.kind);
    if (!item || d === undefined) return;
    if (d === null ? item.state === "open" : item.state === "excluded") return;
    e.preventDefault();
    decideItem(item, d);
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // ------------------------------------------------------------------ the document's highlights
  const stateOf = useMemo(() => new Map(items.map((i) => [i.key, i.state])), [items]);
  const spans: ViewerSpan[] = useMemo(() => {
    const decided = (key: string) => { const s = stateOf.get(key); return s !== undefined && s !== "open" && s !== "excluded"; };
    const excludedIds = new Set(matches.filter((m) => m.excluded).map((m) => m.id));
    return [
      ...(layers.sim ? [
        ...report.spans.filter((s) => !excludedIds.has(Number(s.id)))
          .map((s) => ({ ...s, resolved: decided(keyOf("match", s.start, s.end)) })),
        ...matches.filter((m) => m.excluded).map((m) => ({
          id: `x:${m.id}`, start: m.start, end: m.end, rank: 99, kind: "excluded" as const, label: "Excluded match",
        })),
      ] : []),
      // AI passages rank last, so where one overlaps a match the match shows.
      ...(layers.ai ? aiSegments.map((s) => ({
        id: `ai:${s.start}`, start: s.start, end: s.end, rank: 99, kind: s.label, label: "Reads as AI-written",
        resolved: decided(keyOf("ai", s.start, s.end)),
      })) : []),
    ];
  }, [layers, report.spans, matches, aiSegments, stateOf]);

  const ticks: PadTick[] = useMemo(() => items.filter((i) => i.state !== "excluded").map((i) => ({
    id: i.kind === "ai" ? `ai:${i.start}` : String(i.matchId),
    color: i.kind === "ai" ? "var(--ai-solid)" : matchVars(i.rank ?? 1).line,
    label: `${i.kind === "ai" ? "AI-written passage" : `Match, source ${i.rank}`}: ${snippet(text.slice(i.start, i.end), 8)}`,
    dim: i.state !== "open",
  })), [items, text]);

  const rows = items.map((item) => ({
    item, snippet: snippet(text.slice(item.start, item.end), 16), color: item.kind === "ai" ? "var(--ai-solid)" : matchVars(item.rank ?? 1).line,
    meta: item.kind === "ai" ? "Reads as AI-written"
      : `Source ${item.rank}: ${sourceOf.get(matches.find((m) => m.id === item.matchId)?.sourceId ?? -1)?.host ?? ""}`,
  }));

  // ------------------------------------------------------------------ the Sources tab (compare, exclude)
  const index = visible.findIndex((m) => String(m.id) === selectedId);
  const selected = index >= 0 ? visible[index] : undefined;
  const card = (s: Report["sources"][number]) => {
    const first = visible.find((m) => m.sourceId === s.sourceId);
    return (
      <SourceCard key={s.sourceId} rank={s.excluded ? null : s.rank} percent={s.percent} type={s.type} title={s.title}
        host={s.host} words={s.matchedWords} excluded={s.excluded} busy={busy === `s${s.sourceId}`}
        onSelect={first && (() => select(String(first.id)))}
        onToggleExclude={() => act(`s${s.sourceId}`, () => excludeSource(report.id, s.sourceId, !s.excluded))} />
    );
  };
  const counted = report.sources.filter((s) => !s.excluded && s.rank !== null);
  const uncounted = report.sources.filter((s) => !s.excluded && s.rank === null);
  const excludedSources = report.sources.filter((s) => s.excluded);
  const excludedMatches = matches.filter((m) => m.excluded);

  const sources = selected ? (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => select(undefined)}>
        <ArrowLeft aria-hidden className="size-4" /> All sources
      </Button>
      <SplitCompare rank={selected.rank as number} position={`${index + 1} of ${visible.length}`}
        draft={draftPassage(text, selected)} source={sourcePassage(selected.source)}
        sourceTitle={sourceOf.get(selected.sourceId)?.title ?? ""} url={sourceOf.get(selected.sourceId)?.url ?? undefined}
        excluding={busy === `m${selected.id}`}
        onPrev={index > 0 ? () => select(String(visible[index - 1].id)) : undefined}
        onNext={index < visible.length - 1 ? () => select(String(visible[index + 1].id)) : undefined}
        onExclude={() => act(`m${selected.id}`, async () => {
          setMatchExcluded({ id: selected.id, excluded: true });
          await excludeMatch(report.id, selected.id, true);
          setSelectedId(undefined);
        })} />
    </div>
  ) : (
    <div className="space-y-6">
      {counted.length > 0 ? <ul aria-label="Sources by rank">{counted.map((s) => card(s))}</ul>
        : <p className="text-sm text-muted">No source counts toward the score.</p>}
      {uncounted.length > 0 && (
        <section aria-labelledby="uncounted" className="space-y-2">
          <h3 id="uncounted" className="text-sm font-semibold">Not counted</h3>
          <p className="text-xs text-muted">A higher source already covers every word these matched, or your filters hide them.</p>
          <ul>{uncounted.map((s) => card(s))}</ul>
        </section>
      )}
      <section aria-labelledby="excluded" className="space-y-2 border-t border-border pt-4">
        <h3 id="excluded" className="text-sm font-semibold">Excluded</h3>
        {excludedSources.length + excludedMatches.length === 0 ? (
          <p className="text-xs text-muted">Sources and matches you exclude from this report show up here.</p>
        ) : (
          <ul>
            {excludedSources.map((s) => card(s))}
            {excludedMatches.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-b border-border py-3 text-sm text-muted last:border-0">
                <span className="min-w-0 flex-1 truncate">Match: “{firstWords(text.slice(m.start, m.end))}”</span>
                <Button variant="ghost" size="sm" className="-mr-2 h-7 px-2 text-xs" loading={busy === `m${m.id}`}
                  aria-label={`Restore the match starting “${firstWords(text.slice(m.start, m.end))}”`}
                  onClick={() => act(`m${m.id}`, async () => {
                    setMatchExcluded({ id: m.id, excluded: false });
                    await excludeMatch(report.id, m.id, false);
                  })}>Restore</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const toggle = (key: "sim" | "ai", label: string, value: number | null, note: string | undefined, color: string) => (
    <button type="button" aria-pressed={layers[key]} disabled={key === "ai" && !aiUsable} title={note}
      onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
      className={cx("focus-ring inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        layers[key] ? "border-accent bg-bg text-text" : "border-border bg-transparent text-muted hover:text-text")}>
      <span aria-hidden className={cx("size-2.5 rounded-sm", !layers[key] && "opacity-40")} style={{ background: color }} />
      {label}
      <span className="font-mono text-xs font-medium text-muted">{note ?? (value === null ? "" : `${Math.round(value)}%`)}</span>
    </button>
  );

  const comparing = selected !== undefined && panel === "sources";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span id="layers-label" className="text-xs font-semibold uppercase tracking-wider text-muted">Layers</span>
        <div role="group" aria-labelledby="layers-label" className="flex flex-wrap gap-2">
          {toggle("sim", "Similarity", report.score, undefined, "var(--match-1-solid)")}
          {toggle("ai", "AI writing", ai?.score ?? null, aiNote, "var(--ai-solid)")}
        </div>
      </div>
      <div className={cx("grid min-h-0 flex-1 items-stretch gap-6", comparing ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border max-lg:h-[70dvh]">
          <PadPane scroller={scroller} ticks={ticks} label="Draft" className="h-full" onTick={focusBySpan}>
            <DocumentViewer title={report.title} text={text} spans={spans} selectedId={selectedId}
              onSelect={focusBySpan} bibliographyStart={report.bibliographyStart ?? undefined}
              layout={report.layout} media={`/documents/${report.documentId}/media`} />
          </PadPane>
        </div>
        <aside ref={aside} aria-label="Report panel"
          className="min-h-0 min-w-0 scroll-mt-20 rounded-lg border border-border bg-bg max-lg:h-[70dvh] lg:overflow-hidden">
          <PanelTabs value={panel} onValueChange={setPanel} tabs={[
            { value: "resolve", label: total > done ? `To resolve (${total - done})` : "To resolve", content: (
              <ResolveList rows={rows} done={done} total={total} activeKey={activeKey} busy={pending}
                onActive={(key) => { const item = items.find((i) => i.key === key); if (item) focusItem(item); }}
                onDecide={decideItem} onCompare={(item) => select(String(item.matchId))} />
            ) },
            { value: "sources", label: "Sources", content: sources },
            { value: "filters", label: "Filters", content: <Filters key={JSON.stringify(report.settings)} reportId={report.id} saved={report.settings} /> },
          ]} />
        </aside>
      </div>
    </div>
  );
}

// S11. Edits stay local until Apply; a new saved state (after the rescore) resets the form via its key.
function Filters({ reportId, saved }: { reportId: number; saved: ReportSettings }) {
  const [quotes, setQuotes] = useState(saved.excludeQuotes);
  const [bib, setBib] = useState(saved.excludeBibliography);
  const [words, setWords] = useState(String(saved.smallMatchWords));
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const dirty = quotes !== saved.excludeQuotes || bib !== saved.excludeBibliography || words !== String(saved.smallMatchWords);
  const reset = () => {
    setQuotes(saved.excludeQuotes);
    setBib(saved.excludeBibliography);
    setWords(String(saved.smallMatchWords));
    setError(undefined);
  };
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      startTransition(async () => {
        const result = await saveFilters(reportId, { excludeQuotes: quotes, excludeBibliography: bib, smallMatchWords: Number(words) });
        setError(result.error);
      });
    }}>
      <div>
        <Switch id="f-quotes" label="Leave out quoted text" hint="Matches mostly inside double quotes stop counting."
          checked={quotes} onCheckedChange={setQuotes} />
        <Switch id="f-bib" label="Leave out the reference list" hint="Matches after a References, Bibliography or Works cited heading."
          checked={bib} onCheckedChange={setBib} />
      </div>
      <TextField id="f-words" label="Leave out small sources" unit="words" type="number" min={0} max={1000} step={1} inputMode="numeric"
        hint="Sources whose counted matches cover fewer words than this. 0 keeps every source."
        value={words} onChange={(e) => setWords(e.target.value)} error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!dirty} loading={pending}>Apply</Button>
        <Button variant="secondary" disabled={!dirty || pending} onClick={reset}>Reset</Button>
      </div>
    </form>
  );
}

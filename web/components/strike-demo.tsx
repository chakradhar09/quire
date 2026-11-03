"use client";
// Landing hero demo: a sample sheet with three matches, resolved one by one the way the report does it.
// Each resolution is one chained sequence (lib/motion.ts): the match is struck through, its footnote
// number pops in, the source line appears under the sheet, the item in the list is struck, its label
// shows, and the progress fills. Loops only while on screen and the tab is visible, after the hero's
// own entrance (startAfter); under reduced motion it shows the resolved sheet.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Pause, Play } from "lucide-react";
import { chain, enter, transit } from "@/lib/motion";
import { matchVars } from "./evidence";
import { ProgressBar, cx } from "./ui";

// Synthetic sample, labelled as such on the sheet. Sources are illustrative.
const SAMPLE: (string | { text: string; item: number })[] = [
  "Coral reefs cover less than one percent of the ocean floor, yet ",
  { text: "they support roughly a quarter of all known marine species", item: 0 },
  ". When water stays too warm for several weeks, ",
  { text: "corals expel the algae that live in their tissue and turn white", item: 1 },
  ", a process known as bleaching. Recovery is possible if conditions return to normal quickly, but ",
  { text: "repeated heat waves leave reefs little time to rebuild", item: 2 },
  ".",
];
const SOURCES = [
  { title: "Why coral reefs matter", host: "oceanfacts.example.org" },
  { title: "Thermal stress in reef corals", host: "journal.example.edu" },
];
// Which source each match comes from; footnotes number the sources in the order they are first cited.
const ITEMS = [0, 1, 0];

// One resolution, each step picking up partway through the one before. It opens on a short rest (the
// eye finds the match), the strike draws through it, and the footnote number lands with an overshoot:
// that landing is the beat the sequence builds to. The quieter steps follow faster, and the progress
// fills slowest, because it carries the weight of the whole list.
const [STRIKE, NOTE, SOURCE, LISTED, LABEL, PROGRESS] = chain([
  { dur: 520, link: 0.85, ease: "standard" },
  { dur: 300, link: 0.5, ease: "settle" },
  { dur: 360, link: 0.4, ease: "enter" },
  { dur: 420, link: 0.7, ease: "standard" },
  { dur: 300, link: 0.3, ease: "enter" },
  { dur: 700, ease: "expressive" },
], 250);
const STEP_MS = PROGRESS.at + PROGRESS.dur + 900; // stillness after one resolution, before the next
const HOLD_MS = 3200; // all resolved, before starting over
// Starting over undoes everything at once and quickly.
const OUT: CSSProperties = { transitionDelay: "0ms", transitionDuration: "200ms", transitionTimingFunction: "var(--motion-exit)" };

export function StrikeDemo({ startAfter = 0 }: { startAfter?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(0);
  const [counted, setCounted] = useState(0); // what the counter reads, caught up when the progress fills
  const [paused, setPaused] = useState(false);
  const at = useRef(0); // the step shown, kept across pausing
  const started = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0, countTimer = 0, visible = false;
    const schedule = () => {
      clearTimeout(timer);
      if (reduced) { timer = window.setTimeout(() => { setDone(ITEMS.length); setCounted(ITEMS.length); }); return; }
      if (!visible || paused || document.hidden) return;
      const wait = !started.current ? startAfter : at.current >= ITEMS.length ? HOLD_MS : STEP_MS;
      timer = window.setTimeout(() => {
        started.current = true;
        at.current = at.current >= ITEMS.length ? 0 : at.current + 1;
        const n = at.current;
        setDone(n);
        clearTimeout(countTimer);
        if (n === 0) setCounted(0);
        else countTimer = window.setTimeout(() => setCounted(n), PROGRESS.at);
        schedule();
      }, wait);
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); });
    io.observe(el);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer); clearTimeout(countTimer); io.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [paused, startAfter]);

  const cited = ITEMS.slice(0, done);
  const notes = [...new Set(ITEMS)];
  const footnote = (source: number) => notes.indexOf(source) + 1;
  const timing = (on: boolean, t: Parameters<typeof transit>[0]) => (on ? transit(t) : OUT);

  return (
    <div ref={root} className="grid gap-3">
      <div role="img" aria-label="Example: three matches in a sample paragraph, each struck and cited in turn" className="tilt">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_200px]">
          <div aria-hidden className="sheet margin-rule rounded-sm py-8 pr-7 pl-16 text-text shadow-pop">
            <p className="mb-4 font-mono text-xs font-medium tracking-wider text-muted">SAMPLE TEXT · No. 001</p>
            <p className="font-serif text-doc">
              {SAMPLE.map((part, i) => {
                if (typeof part === "string") return <span key={i}>{part}</span>;
                const source = ITEMS[part.item];
                const vars = matchVars(source + 1);
                const struck = part.item < done;
                return (
                  <span key={i}>
                    <mark style={{ ...timing(struck, STRIKE), "--tint": vars.tint, "--line": vars.line } as unknown as CSSProperties}
                      className={cx("ev-strike bg-transparent text-inherit", struck && "is-struck")}>
                      {part.text}
                    </mark>
                    {struck && (
                      <sup className="enter-pop ml-0.5 inline-block font-sans text-xs font-semibold text-accent" style={enter(NOTE) as CSSProperties}>
                        {footnote(source)}
                      </sup>
                    )}
                  </span>
                );
              })}
            </p>
            <ol className="mt-6 space-y-1 border-t border-border pt-3 font-sans text-xs text-muted">
              {notes.map((source) => {
                const on = cited.includes(source);
                return (
                  <li key={source} style={timing(on, SOURCE)}
                    className={cx("transition-opacity motion-reduce:transition-none", on ? "opacity-100" : "opacity-0")}>
                    {footnote(source)}. {SOURCES[source].title}, {SOURCES[source].host}
                  </li>
                );
              })}
            </ol>
          </div>
          <div aria-hidden className="sheet flex flex-col gap-3 self-start rounded-sm p-4 text-sm">
            {/* The list's last resolution ends on "All resolved" landing with an overshoot: the payoff. */}
            {counted === ITEMS.length
              ? <p key="all" className="enter-pop origin-left font-semibold" style={enter({ at: 0, dur: 420, ease: "settle" }) as CSSProperties}>All resolved</p>
              : <p className="font-semibold">{counted} of {ITEMS.length} resolved</p>}
            <ProgressBar value={(done / ITEMS.length) * 100} label="Sample passages resolved" fillStyle={timing(done > 0, PROGRESS)} />
            <ol className="space-y-2.5">
              {ITEMS.map((source, i) => {
                const struck = i < done;
                const text = (SAMPLE.find((p) => typeof p !== "string" && p.item === i) as { text: string }).text;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 size-2 shrink-0 rounded-sm" style={{ background: matchVars(source + 1).line }} />
                    <span className="min-w-0">
                      <span style={timing(struck, LISTED)}
                        className={cx("strike-draw block truncate font-serif text-xs", struck ? "is-struck text-muted" : "state-open")}>{text}</span>
                      <span style={timing(struck, LABEL)}
                        className={cx("mt-0.5 flex items-center gap-1 text-xs text-muted transition-opacity motion-reduce:transition-none", struck ? "opacity-100" : "opacity-0")}>
                        <Check className="size-3" />Quoted and cited
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
      <button type="button" onClick={() => setPaused((p) => !p)}
        className="focus-ring inline-flex items-center gap-1.5 justify-self-end rounded-sm px-1 text-xs text-muted hover:text-text motion-reduce:hidden">
        {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
        {paused ? "Play the example" : "Pause the example"}
      </button>
    </div>
  );
}

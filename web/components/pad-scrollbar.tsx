"use client";
// The document pane: its own scroll area (the page does not scroll), with a custom scrollbar whose track
// carries a tick for every flagged passage, so the whole draft's evidence can be seen and jumped to.
// Wheel, keyboard and touch scrolling stay native; only the scrollbar's look is replaced.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { scrollFor, thumb, tick } from "@/lib/scrollbar.ts";
import { cx } from "./ui";

export type PadTick = { id: string; color: string; label: string; dim?: boolean };

export function PadPane({ children, ticks, label, scroller, onTick, className }: {
  children: ReactNode; ticks: PadTick[]; label: string; scroller: RefObject<HTMLDivElement | null>;
  onTick: (id: string) => void; className?: string;
}) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ client: 1, scroll: 1, top: 0, track: 1 });
  const [at, setAt] = useState<Record<string, [number, number]>>({}); // passage id -> [top, height] in the content
  const drag = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el || !track.current) return;
    const next = { client: el.clientHeight, scroll: el.scrollHeight, top: el.scrollTop, track: track.current.clientHeight };
    setM((prev) => (prev.client === next.client && prev.scroll === next.scroll && prev.top === next.top && prev.track === next.track ? prev : next));
  }, [scroller]);

  // Passage positions come from the laid-out draft (pictures and tables included), measured from each
  // passage's first to last highlighted piece.
  const place = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const base = el.getBoundingClientRect().top - el.scrollTop;
    const next: Record<string, [number, number]> = {};
    for (const t of ticks) {
      const marks = el.querySelectorAll<HTMLElement>(`[data-span="${CSS.escape(t.id)}"]`);
      if (!marks.length) continue;
      const first = marks[0].getBoundingClientRect();
      const last = marks[marks.length - 1].getBoundingClientRect();
      next[t.id] = [first.top - base, last.bottom - first.top];
    }
    setAt((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [scroller, ticks]);

  useLayoutEffect(() => { measure(); place(); }, [measure, place]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => { measure(); place(); });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); cancelAnimationFrame(frame); };
  }, [scroller, measure, place]);

  const t = thumb(m.top, m.client, m.scroll, m.track);

  const dragTo = (clientY: number) => {
    const el = scroller.current;
    if (!el || !track.current || drag.current === null) return;
    const y = clientY - track.current.getBoundingClientRect().top - drag.current;
    el.scrollTo({ top: scrollFor(y, m.client, m.scroll, m.track) });
  };

  return (
    <div className={cx("flex min-h-0", className)}>
      <div ref={scroller} id={id} tabIndex={0} role="region" aria-label={label} className="pad-scroll focus-ring min-w-0 flex-1 overflow-y-auto">
        {children}
      </div>
      <div ref={track} aria-label={`${label}: scroll position and flagged passages`}
        className="relative w-4 shrink-0 border-l border-border bg-surface"
        onPointerDown={(e) => {
          // A click on the bare track pages toward the click; the thumb and ticks handle their own.
          if (e.target !== e.currentTarget || !scroller.current) return;
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          scroller.current.scrollBy({ top: Math.sign(y - (t.top + t.height / 2)) * m.client * 0.9, behavior: "smooth" });
        }}>
        {t.visible && (
          <div role="scrollbar" aria-orientation="vertical" aria-controls={id} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((m.top / Math.max(1, m.scroll - m.client)) * 100)}
            style={{ top: t.top, height: t.height }}
            className="absolute inset-x-0.5 cursor-grab touch-none rounded-sm bg-border-input/35 hover:bg-border-input/55 active:cursor-grabbing"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = e.clientY - e.currentTarget.getBoundingClientRect().top;
            }}
            onPointerMove={(e) => dragTo(e.clientY)}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }} />
        )}
        {ticks.map((p) => {
          const pos = at[p.id];
          if (!pos) return null;
          const r = tick(pos[0], pos[1], m.scroll, m.track);
          return (
            <button key={p.id} type="button" aria-label={p.label} onClick={() => onTick(p.id)}
              style={{ top: r.top, height: Math.max(r.height, 6), "--c": p.color } as CSSProperties}
              className={cx("focus-ring absolute inset-x-0 flex items-center transition-opacity", p.dim ? "opacity-35" : "")}>
              <span aria-hidden className="mx-auto w-2.5 rounded-sm bg-(--c)" style={{ height: Math.max(r.height, 3) }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

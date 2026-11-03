"use client";
// The to-resolve list: what is flagged in the draft, in reading order, each open until decided. A decision
// strikes the passage once and keeps it listed, labelled and undoable. Presentational: the report view
// owns the state and the saving.
import { useEffect } from "react";
import { Check, Undo2 } from "lucide-react";
import type { Decision, Item, ItemState } from "@/lib/resolve.ts";
import { Button, ProgressBar, cx } from "./ui";

const DONE_LABEL: Record<ItemState, string> = {
  open: "Open", cited: "Quoted and cited", rewritten: "Rewritten", kept: "Kept as written", excluded: "Excluded",
};

type Row = { item: Item; snippet: string; meta: string; color: string };

export function ResolveList({ rows, done, total, activeKey, busy, onActive, onDecide, onCompare }: {
  rows: Row[]; done: number; total: number; activeKey?: string; busy?: boolean;
  onActive: (key: string) => void; onDecide: (item: Item, d: Decision) => void; onCompare: (item: Item) => void;
}) {
  // Keep the active item in view when the keyboard moves it.
  useEffect(() => {
    if (activeKey) document.querySelector(`[data-key="${CSS.escape(activeKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  return (
    <div className="space-y-4">
      <div>
        <p className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">
            {total === 0 ? "Nothing to resolve" : done === total ? "All resolved" : `${done} of ${total} resolved`}
          </span>
          {total > 0 && <span className="font-mono text-xs text-muted">{total - done} open</span>}
        </p>
        {total > 0 && <div className="mt-2"><ProgressBar value={(done / total) * 100} label="Passages resolved" /></div>}
      </div>

      <ol aria-label="Flagged passages" className="space-y-2">
        {rows.map(({ item, snippet, meta, color }) => {
          const open = item.state === "open";
          const active = item.key === activeKey;
          return (
            <li key={item.key} data-key={item.key} aria-current={active || undefined}
              className={cx("rounded-md border px-3 py-2.5 transition-colors", active ? "border-accent bg-surface" : "border-border")}>
              <button type="button" onClick={() => onActive(item.key)} className="focus-ring flex w-full items-start gap-2.5 rounded-sm text-left">
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                <span className="min-w-0">
                  <span className={cx("strike-draw block font-serif text-sm",
                    open && "state-open", item.state === "excluded" && "state-excluded text-muted",
                    !open && item.state !== "excluded" && "is-struck text-muted")}>
                    {snippet}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{meta}</span>
                </span>
              </button>
              {open ? (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
                  {item.kind === "match" ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(item, "cited")}>Quote and cite{active && <Kbd k="c" />}</Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(item, "rewritten")}>Rewrite{active && <Kbd k="r" />}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(item, "excluded")}>Exclude{active && <Kbd k="e" />}</Button>
                      <Button size="sm" variant="ghost" onClick={() => onCompare(item)}>Compare</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(item, "rewritten")}>Rewrite{active && <Kbd k="r" />}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(item, "kept")}>Keep{active && <Kbd k="p" />}</Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between pl-5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <Check aria-hidden className="size-3.5" />{DONE_LABEL[item.state]}
                  </span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(item, null)}>
                    <Undo2 aria-hidden className="size-3.5" />Undo{active && <Kbd k="z" />}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {total > 0 && (
        <p className="border-t border-border pt-3 text-xs text-muted">
          Keys: <Kbd k="j" /> <Kbd k="k" /> move, <Kbd k="c" /> cite, <Kbd k="r" /> rewrite, <Kbd k="e" /> exclude, <Kbd k="p" /> keep, <Kbd k="z" /> undo.
        </p>
      )}
    </div>
  );
}

function Kbd({ k }: { k: string }) {
  return <kbd className="ml-1 rounded-sm border border-current/30 px-1 font-mono text-[11px] font-medium opacity-80">{k}</kbd>;
}

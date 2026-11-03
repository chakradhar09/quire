"use client";
// The header's worker light, grown into the queue. With nothing queued it is a quiet status line. While
// drafts are being read or checked it is a button: hovering it previews the queue (each draft and the step
// it is on), and clicking it opens every draft's full sequence. It also keeps the page refreshing while
// anything is unfinished, so the light, the preview and the list below stay current on every page.
import { Dialog, HoverCard } from "radix-ui";
import { X } from "lucide-react";
import { AutoRefresh } from "./auto-refresh";
import { Examination, InlineAlert, cx, exhibit, withBreaks, type StepState } from "./ui";

export type QueueItem = { id: number; title: string; step: string; waiting: boolean; steps: { label: string; state: StepState }[] };

const START = "python main.py in worker/";

export function QueueButton({ state, items }: { state: "idle" | "working" | "stalled"; items: QueueItem[] }) {
  const stalled = state === "stalled";
  if (!items.length && !stalled) {
    // Working with no draft unfinished: a rescore after a filter change, which has no queue to show.
    const working = state === "working";
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-on-shell-muted">
        <span aria-hidden className={cx("size-2 rounded-pill", working ? "breathe bg-lamp" : "bg-on-shell-muted/50")} />
        {/* On a phone the header has no room for the words: the light stays, the words go to screen readers. */}
        <span className="max-sm:sr-only">{working ? "Checking" : "Nothing queued"}</span>
      </p>
    );
  }
  const label = stalled ? "Worker stalled" : "Checking";
  return (
    <>
      <AutoRefresh active={items.length > 0} />
      <Dialog.Root>
        <HoverCard.Root openDelay={150} closeDelay={120}>
          <HoverCard.Trigger asChild>
            <Dialog.Trigger
              className={cx("focus-ring flex h-8 items-center gap-2 rounded-sm px-2 text-xs transition-colors",
                stalled ? "bg-warning-surface text-warning hover:brightness-95" : "text-on-shell-muted hover:bg-on-shell/10 hover:text-on-shell")}
              aria-label={`${label}: ${items.length} in the queue. Open the queue`}>
              <span aria-hidden className={cx("size-2 rounded-pill", stalled ? "bg-warning" : "breathe bg-lamp")} />
              <span className="max-sm:sr-only">{label}</span>
              <span aria-hidden className={cx("rounded-sm px-1.5 font-mono", stalled ? "bg-warning/15" : "bg-on-shell/15 text-on-shell")}>{items.length}</span>
            </Dialog.Trigger>
          </HoverCard.Trigger>
          <HoverCard.Portal>
            <HoverCard.Content align="end" sideOffset={8} collisionPadding={16}
              className="pop-in z-50 w-80 origin-(--radix-hover-card-content-transform-origin) rounded-md border border-border bg-bg p-3 text-text shadow-pop">
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">In the queue · {items.length}</p>
              <ul className="space-y-2">
                {items.slice(0, 4).map((it) => (
                  <li key={it.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-sm">
                    <span className="pt-0.5 font-mono text-xs text-accent">{exhibit(it.id)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold" title={it.title}>{it.title}</span>
                      <span className={cx("block text-xs", it.waiting ? "text-warning" : "text-muted")}>{it.step}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {items.length > 4 && <p className="mt-2 text-xs text-muted">and {items.length - 4} more</p>}
              <p className="mt-3 border-t border-border pt-2 text-xs text-muted">Click to see every step.</p>
            </HoverCard.Content>
          </HoverCard.Portal>
        </HoverCard.Root>
        <Dialog.Portal>
          <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-shell/60" />
          <Dialog.Content
            className="pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[min(80vh,40rem)] w-[min(560px,calc(100vw-32px))] -translate-1/2 flex-col rounded-lg border border-border bg-bg shadow-pop">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <Dialog.Title className="text-lg">In the queue</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">
                  {items.length ? `${items.length} draft${items.length === 1 ? "" : "s"} being read or checked, newest first.` : "Nothing is waiting."}
                </Dialog.Description>
              </div>
              <Dialog.Close className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-text" aria-label="Close the queue">
                <X aria-hidden className="size-4" />
              </Dialog.Close>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-4">
              {stalled && (
                <InlineAlert variant="warning" title="The worker isn't picking up drafts">
                  Start it with <code className="font-mono">{START}</code>, and the queue carries on where it stopped.
                </InlineAlert>
              )}
              <ol className="divide-y divide-border">
                {items.map((it) => (
                  <li key={it.id} className="grid gap-3 py-4 first:pt-0 last:pb-0">
                    <p className="flex min-w-0 items-center gap-3 font-semibold">
                      <span className="shrink-0 font-mono text-xs font-medium tracking-wider text-accent">{exhibit(it.id)}</span>
                      <span className="block min-w-0 [overflow-wrap:anywhere]">{withBreaks(it.title)}</span>
                    </p>
                    <Examination steps={it.steps} compact note={it.waiting ? `Waiting for the worker. Start it: ${START}` : undefined} />
                  </li>
                ))}
              </ol>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

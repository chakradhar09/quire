"use client";
// A note the reader can close to give the document more room. Closed notes stay closed (remembered in this
// browser under `id`); if storage is blocked it simply closes for this visit.
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

const key = (id: string) => `quire:closed:${id}`;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
const stored = (id: string) => {
  try {
    return localStorage.getItem(key(id)) === "1";
  } catch {
    return false;
  }
};

export function Dismissible({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const [closedNow, setClosedNow] = useState(false);
  // false on the server and while hydrating, so the note is in the first paint and only then hides.
  const remembered = useSyncExternalStore(subscribe, () => stored(id), () => false);
  if (closedNow || remembered) return null;
  return (
    <div className={cx("relative [&>*:first-child]:pr-10", className)}>
      {children}
      <button type="button" aria-label="Close this note"
        onClick={() => {
          setClosedNow(true);
          try {
            localStorage.setItem(key(id), "1");
          } catch {}
          listeners.forEach((fn) => fn());
        }}
        className="focus-ring absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface hover:text-text">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

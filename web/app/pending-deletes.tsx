"use client";
// Delete with undo: the version leaves the list at once and a toast offers Undo for 8 seconds; the draft, its
// reports and its file are deleted only when the toast goes. Lives in the root layout, so moving to another page
// in the meantime still finishes the delete.
// ponytail: closing or reloading the tab before the toast goes keeps the draft; send the delete with
// navigator.sendBeacon on pagehide if that ever matters.
import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";
import { useToast } from "@/components/overlays";
import { deleteDraft } from "./actions";

const Ctx = createContext<{ hidden: ReadonlySet<number>; remove: (id: number, title: string) => void }>({
  hidden: new Set(), remove: () => {},
});
export const usePendingDeletes = () => useContext(Ctx);

export function PendingDeletes({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [, startTransition] = useTransition();
  const show = useCallback((id: number) => setHidden((h) => new Set([...h].filter((x) => x !== id))), []);

  const remove = useCallback((id: number, title: string) => {
    setHidden((h) => new Set(h).add(id));
    toast(`Deleted “${title}”`, "success", {
      duration: 8000,
      undo: () => show(id),
      // Shown again only once it is gone from the list: SQLite can hand a deleted newest id to the next upload.
      onClose: () => startTransition(async () => { await deleteDraft(id); show(id); }),
    });
  }, [toast, show]);

  return <Ctx.Provider value={{ hidden, remove }}>{children}</Ctx.Provider>;
}

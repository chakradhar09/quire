"use client";
// A newer Quire is out: a pill in the header that opens a dialog with the versions, a link to what changed, how to
// update, and the switch for updating automatically when Quire starts (the launcher reads data/settings.json).
import { useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { ArrowUpCircle, X } from "lucide-react";
import { setAutoUpdate } from "@/app/actions";
import { Switch } from "./overlays";

export function UpdateNotice({ version, current, url, autoUpdate }: { version: string; current: string; url: string; autoUpdate: boolean }) {
  const [auto, setAuto] = useState(autoUpdate);
  const [, startTransition] = useTransition();
  const toggle = (v: boolean) => { setAuto(v); startTransition(() => setAutoUpdate(v)); };
  return (
    <Dialog.Root>
      <Dialog.Trigger className="focus-ring flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-on-shell transition-colors hover:bg-on-shell/10">
        <ArrowUpCircle aria-hidden className="size-4 text-lamp" />
        <span className="max-sm:sr-only">Update {version}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-shell/60" />
        <Dialog.Content className="pop-in fixed top-1/2 left-1/2 z-50 w-[min(480px,calc(100vw-32px))] -translate-1/2 rounded-lg border border-border bg-bg p-6 shadow-pop">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg">Quire {version} is out</Dialog.Title>
            <Dialog.Close aria-label="Close" className="focus-ring rounded-sm text-muted hover:text-text"><X aria-hidden className="size-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-sm text-muted">
            You have {current}. {url && <a href={url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">See what changed</a>}
          </Dialog.Description>
          <p className="mt-4 text-sm">
            {auto ? "It installs the next time Quire starts." : "To update, close Quire and open Update Quire from the Start menu (or run scripts/update)."}
            {" "}Your drafts and reports stay where they are.
          </p>
          <div className="mt-2">
            <Switch id="auto-update" label="Update automatically when Quire starts" checked={auto} onCheckedChange={toggle}
              hint="Quire checks GitHub for a new release once a day either way." />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

"use client";
// Installs a newer release now, from Settings and the header's update dialog. The updater stops Quire, updates it
// and starts it again in a new tab; on Windows it shows its progress in a window of its own.
import { useState, useTransition } from "react";
import { runUpdate } from "@/app/actions";
import { Button, InlineAlert } from "./ui";

export function UpdateButton({ version, inWindow }: { version: string; inWindow: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; started?: boolean }>({});
  if (state.started) {
    return (
      <InlineAlert variant="info" title={`Updating to ${version}`} live>
        {inWindow ? "Its progress shows in the window that opened. " : "Its progress is written to data/update.log. "}
        Quire closes now and opens again in a new tab when it is done, in a few minutes. You can close this tab.
      </InlineAlert>
    );
  }
  return (
    <div className="grid gap-3">
      {state.error && <InlineAlert variant="danger" title="The update didn't start" live>{state.error}</InlineAlert>}
      <div>
        <Button loading={pending} onClick={() => start(async () => { const r = await runUpdate(); setState(r.error ? r : { started: true }); })}>
          Update to {version}
        </Button>
      </div>
    </div>
  );
}

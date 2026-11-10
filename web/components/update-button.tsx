"use client";
// Installs a newer release now, from Settings and the header's update dialog. The updater stops Quire, updates it
// and starts it again in a new tab; on Windows it shows its progress in a window of its own. In the dialog it is the
// footer (`later` beside it, as in the app's other dialogs); on Settings a row like the switch's (`lead` on the left,
// the button on the right). Once started, the message takes the row's place.
import { useState, useTransition, type ReactNode } from "react";
import { runUpdate } from "@/app/actions";
import { Button, InlineAlert } from "./ui";

export function UpdateButton({ version, inWindow, later, lead }: {
  version: string; inWindow: boolean; later?: ReactNode; lead?: ReactNode;
}) {
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
      {state.error ? <InlineAlert variant="danger" title="The update didn't start" live>{state.error}</InlineAlert> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        {lead}
        <div className={lead ? "flex gap-2" : "ml-auto flex gap-2"}>
          {later}
          <Button size={lead ? "sm" : "md"} loading={pending} onClick={() => start(async () => { const r = await runUpdate(); setState(r.error ? r : { started: true }); })}>
            Update to {version}
          </Button>
        </div>
      </div>
    </div>
  );
}

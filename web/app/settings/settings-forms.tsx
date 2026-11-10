"use client";
// The Settings page's parts: the Brave Search API key (saved by saveBraveKey; the page only ever holds its
// last four characters), updates (the Update button only when a newer release is out, and the switch for installing
// new releases when Quire starts), and uninstalling.
import { useActionState, useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { Switch } from "@/components/overlays";
import { Button, InlineAlert, TextField } from "@/components/ui";
import { UpdateButton } from "@/components/update-button";
import { runUninstall, saveBraveKey, setAutoUpdate } from "../actions";

export function SettingsForms({ masked, keyElsewhere, autoUpdate, update, inWindow, guideUrl }: {
  masked: string; keyElsewhere: boolean; autoUpdate: boolean; update: string | null; inWindow: boolean; guideUrl: string;
}) {
  const [state, action, pending] = useActionState(saveBraveKey, {} as { error?: string; saved?: boolean });
  const [auto, setAuto] = useState(autoUpdate);
  const [, startTransition] = useTransition();
  const [replacing, setReplacing] = useState(false);
  const [opening, startOpening] = useTransition();
  const [uninstall, setUninstall] = useState<{ error?: string; opened?: boolean }>({});
  const asking = !masked || replacing;

  return (
    <div className="space-y-8">
      <section aria-labelledby="key-heading" className="rounded-lg border border-border bg-bg p-5">
        <h2 id="key-heading" className="text-lg">Brave Search API key</h2>
        <p className="mt-1 text-sm text-muted">
          The similarity check finds matching pages with Brave Search, using a key of your own.{" "}
          <a href={guideUrl} target="_blank" rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1 rounded-sm font-semibold text-accent underline">
            How to get a key<ExternalLink aria-hidden className="size-3.5" />
          </a>
        </p>

        <div className="mt-4 grid gap-3">
          {state.error ? <InlineAlert variant="danger" title="The key was not saved" live>{state.error}</InlineAlert> : null}
          {state.saved && !state.error ? <InlineAlert variant="success" title="Saved" live>The next check uses it.</InlineAlert> : null}
          {keyElsewhere && !masked && (
            <InlineAlert variant="info" title="A key is set in worker/.env">Quire uses it. Paste one here to use that instead.</InlineAlert>
          )}

          {asking ? (
            <form action={action} onSubmit={() => setReplacing(false)} className="grid gap-3">
              <TextField id="brave-key" name="key" type="password" label={masked ? "New key" : "Key"} required autoComplete="off"
                spellCheck={false} placeholder="BSA…" hint="Stays on this PC. Only the searches themselves go to Brave." />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={pending}>Save key</Button>
                {masked ? <Button variant="ghost" onClick={() => setReplacing(false)}>Cancel</Button> : null}
              </div>
            </form>
          ) : (
            <form action={action} className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-sm" aria-label={`Key ending in ${masked.slice(-4)}`}>{masked}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>Replace</Button>
                <Button type="submit" variant="ghost" size="sm" name="remove" value="1" loading={pending}>Remove</Button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section aria-labelledby="updates-heading" className="rounded-lg border border-border bg-bg p-5">
        <h2 id="updates-heading" className="text-lg">Updates</h2>
        <p className="mt-1 text-sm text-muted">
          Each time Quire starts it asks GitHub whether a newer release is out, and shows it here and in the header.
        </p>
        {/* The setting first, so it stays put; the update row appears under it only while a release is waiting. */}
        <div className="mt-2">
          <Switch id="settings-auto-update" label="Install new releases automatically when Quire starts"
            checked={auto} onCheckedChange={(v) => { setAuto(v); startTransition(() => setAutoUpdate(v)); }}
            hint="Otherwise, use the Update button when a new release is out." />
          {update ? (
            <div className="border-b border-border py-3">
              <UpdateButton version={update} inWindow={inWindow} lead={
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Quire {update} is out</p>
                  <p className="text-xs text-muted">Your drafts, reports and settings are kept.</p>
                </div>} />
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="uninstall-heading" className="rounded-lg border border-border bg-bg p-5">
        <h2 id="uninstall-heading" className="text-lg">Uninstall</h2>
        <p className="mt-1 text-sm text-muted">Removes Quire, its shortcuts and its entry in the list of apps.</p>
        <div className="mt-2 grid gap-3 border-b border-border py-3">
          {uninstall.error ? <InlineAlert variant="danger" title="The uninstaller didn't open" live>{uninstall.error}</InlineAlert> : null}
          {uninstall.opened ? (
            <InlineAlert variant="info" title="The uninstaller opened in a window of its own" live>
              Answer its questions there. Quire closes once it starts removing.
            </InlineAlert>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Uninstall Quire from this PC</p>
                <p className="text-xs text-muted">It asks first, and asks whether to keep your drafts, reports and settings.</p>
              </div>
              {inWindow ? (
                <Button variant="secondary" size="sm" loading={opening}
                  onClick={() => startOpening(async () => { const r = await runUninstall(); setUninstall(r.error ? r : { opened: true }); })}>
                  Uninstall
                </Button>
              ) : (
                <p className="text-sm">Run <code className="font-mono">quire-uninstall</code> in a terminal</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

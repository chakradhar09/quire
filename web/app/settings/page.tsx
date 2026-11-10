import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppHeader, Skeleton } from "@/components/ui";
import { WorkerLight } from "@/components/worker-light";
import { hasBraveKey, maskedKey, readSettings } from "@/lib/settings";
import { scriptsInWindow } from "@/lib/scripts";
import { REPO, VERSION, availableUpdate } from "@/lib/updates";
import { SettingsForms } from "./settings-forms";

export const metadata: Metadata = { title: "Settings · Quire" };

async function Forms() {
  await connection();
  const s = readSettings();
  // A key set the old way (worker/.env) still works; the page says so instead of asking for one.
  const elsewhere = !s.braveApiKey && hasBraveKey();
  const update = await availableUpdate();
  return <SettingsForms masked={maskedKey(s.braveApiKey)} keyElsewhere={elsewhere} autoUpdate={s.autoUpdate}
    update={update?.version ?? null} inWindow={scriptsInWindow}
    guideUrl={`https://github.com/${REPO}#getting-a-brave-search-api-key`} />;
}

// Your Brave Search key, updating Quire (saved in data/settings.json on this PC) and uninstalling it.
export default function SettingsPage() {
  return (
    <>
      <AppHeader current="settings" status={<Suspense><WorkerLight /></Suspense>} />
      <main id="main" className="mx-auto w-full max-w-2xl px-4 py-8 md:px-8">
        <h1 className="text-xl">Settings</h1>
        <p className="mt-1 mb-8 text-sm text-muted">Saved on this PC, in the data folder next to your drafts. Quire {VERSION}.</p>
        <Suspense fallback={<Skeleton className="h-72 w-full" />}><Forms /></Suspense>
      </main>
    </>
  );
}

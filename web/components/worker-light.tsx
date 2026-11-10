// The header's worker light, read from the job queue and the drafts still being read or checked: nothing
// queued, working, or stalled (a job has waited over a minute, so the worker could not be started).
// Server component; pass it to AppHeader as `status`. The queue itself is shown by QueueButton. It is on every
// page that queues work and re-renders after each such action, so it is also where the worker gets started.
import { after, connection } from "next/server";
import { listDrafts, workerState } from "@/lib/db";
import { currentStep, queueSteps, unfinished } from "@/lib/queue";
import { readSettings } from "@/lib/settings";
import { VERSION, availableUpdate } from "@/lib/updates";
import { scriptsInWindow } from "@/lib/scripts";
import { ensureWorker } from "@/lib/worker";
import { QueueButton } from "./queue-button";
import { UpdateNotice } from "./update-notice";

// `updates={false}` on Settings, which shows the Update button itself.
export async function WorkerLight({ updates = true }: { updates?: boolean }) {
  await connection();
  // Asked first and awaited last: GitHub answers (once per start) while the queue is read.
  const pending = updates ? availableUpdate() : null; // shown beside the light, so every working page carries it
  const { state } = workerState();
  if (state !== "idle") after(() => { ensureWorker(); }); // starting a process is no part of rendering
  const items = listDrafts()
    .filter((d) => d.status !== "rejected" && unfinished(d))
    .map((d) => ({ id: d.id, title: d.title, step: currentStep(d), waiting: d.waiting, steps: queueSteps(d) }));
  const update = await pending;
  return (
    <>
      {update ? <UpdateNotice version={update.version} current={VERSION} url={update.url} autoUpdate={readSettings().autoUpdate}
        inWindow={scriptsInWindow} /> : null}
      <QueueButton state={state} items={items} />
    </>
  );
}

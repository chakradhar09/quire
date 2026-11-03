// The header's worker light, read from the job queue and the drafts still being read or checked: nothing
// queued, working, or stalled (a job has waited over a minute, so the worker could not be started).
// Server component; pass it to AppHeader as `status`. The queue itself is shown by QueueButton. It is on every
// page that queues work and re-renders after each such action, so it is also where the worker gets started.
import { connection } from "next/server";
import { listDrafts, workerState } from "@/lib/db";
import { currentStep, queueSteps, unfinished } from "@/lib/queue";
import { readSettings } from "@/lib/settings";
import { VERSION, availableUpdate } from "@/lib/updates";
import { ensureWorker } from "@/lib/worker";
import { QueueButton } from "./queue-button";
import { UpdateNotice } from "./update-notice";

export async function WorkerLight() {
  await connection();
  const { state } = workerState();
  if (state !== "idle") ensureWorker();
  const update = await availableUpdate(); // shown beside the light, so every working page carries it
  const items = listDrafts()
    .filter((d) => d.status !== "rejected" && unfinished(d))
    .map((d) => ({ id: d.id, title: d.title, step: currentStep(d), waiting: d.waiting, steps: queueSteps(d) }));
  return (
    <>
      {update && <UpdateNotice version={update.version} current={VERSION} url={update.url} autoUpdate={readSettings().autoUpdate} />}
      <QueueButton state={state} items={items} />
    </>
  );
}

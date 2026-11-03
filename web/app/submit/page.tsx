import type { Metadata } from "next";
import { AppHeader, Skeleton } from "@/components/ui";
import { connection } from "next/server";
import { paperChoices } from "../paper-choices";
import { IntakeSheet } from "./intake-sheet";
import { Suspense } from "react";
import { WorkerLight } from "@/components/worker-light";
import { BraveKeyNotice } from "@/components/brave-key-notice";

export const metadata: Metadata = { title: "Check a draft · Quire" };

async function Intake() {
  await connection();
  return <IntakeSheet papers={paperChoices()} />;
}

// S04: paste the draft or drop its file on one sheet. Either way it is checked as soon as it has been read.
export default function SubmitPage() {
  return (
    <>
      <AppHeader current="submit" status={<Suspense><WorkerLight /></Suspense>} />
      <div className="min-h-[calc(100dvh-3.5rem)]">
        <main id="main" className="mx-auto w-full max-w-content-max px-4 py-8 md:px-8">
          <h1 className="text-xl">Check a draft</h1>
          <p className="mt-1 mb-8 max-w-prose text-sm text-muted">
            Paste the text or drop the file. It is checked against the web as soon as it has been read.
          </p>
          <Suspense><BraveKeyNotice /></Suspense>
          <Suspense fallback={<Skeleton className="h-96 w-full lg:w-[calc(100%-20rem)]" />}>
            <Intake />
          </Suspense>
        </main>
      </div>
    </>
  );
}

"use client";
// Unexpected failures while rendering a page, such as the database being out of step with the app.
import Link from "next/link";
import { AppHeader, Button, InlineAlert, buttonClass } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <>
      <AppHeader current="drafts" />
      <main id="main" className="mx-auto w-full max-w-paper px-4 py-8">
        <h1 className="mb-4 text-xl">This page couldn&apos;t be shown</h1>
        <InlineAlert variant="danger" title="Something went wrong while loading it" live>
          <p className="font-mono text-xs break-words">{message}</p>
          <p className="mt-2">If it mentions a missing column or table, the database needs its migrations run: python db/migrate.py from the project folder.</p>
        </InlineAlert>
        <div className="mt-6 flex gap-2">
          <Button onClick={retry}>Try again</Button>
          <Link href="/drafts" className={buttonClass("secondary")}>Back to drafts</Link>
        </div>
      </main>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader, EmptyState, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Not found · Quire" };

// A draft or report that was deleted, or a link typed by hand.
export default function NotFound() {
  return (
    <>
      <AppHeader current="drafts" />
      <main id="main" className="mx-auto w-full max-w-content-max px-4 py-8 md:px-8">
        <div className="rounded-lg border border-border bg-bg">
          <EmptyState title="Nothing on the bench at this address"
            body="The draft or report may have been deleted, or the link is wrong."
            action={<Link href="/drafts" className={buttonClass()}>Back to drafts</Link>} />
        </div>
      </main>
    </>
  );
}

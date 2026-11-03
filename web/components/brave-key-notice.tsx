// Shown where checks start when the worker has no Brave Search key, so you add it before checking: without one
// the similarity check fails (the AI estimate still runs).
import Link from "next/link";
import { connection } from "next/server";
import { hasBraveKey } from "@/lib/settings";
import { InlineAlert } from "./ui";

export async function BraveKeyNotice() {
  await connection();
  if (hasBraveKey()) return null;
  return (
    <div className="mb-6">
      <InlineAlert variant="warning" title="Add your Brave Search API key first">
        Without it the similarity check can&apos;t search the web; only the AI-writing estimate runs.{" "}
        <Link href="/settings" className="focus-ring rounded-sm font-semibold underline">Add it in Settings</Link>
      </InlineAlert>
    </div>
  );
}

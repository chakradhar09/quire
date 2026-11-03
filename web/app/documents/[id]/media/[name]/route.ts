import { readFile } from "node:fs/promises";
import { mediaFile } from "@/lib/db";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// A picture from a draft, for the report viewer. Only the worker's own file names are served (mediaFile),
// never SVG, and proxy.ts already limits who can ask.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const file = mediaFile(id, name);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    return new Response(new Uint8Array(await readFile(file)), {
      headers: {
        "content-type": TYPES[name.split(".")[1]],
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

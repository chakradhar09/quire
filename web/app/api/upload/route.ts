import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { saveUpload } from "@/lib/db";
import { MAX_UPLOAD_BYTES, allowedOrigin, paperFromField } from "@/lib/upload";

// Room for the multipart boundaries and the title around a 50 MB file.
const MAX_BODY = MAX_UPLOAD_BYTES + 1024 * 1024;

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

// S04 upload. A route handler, not a server action, so it checks Origin itself (see lib/upload.ts).
export async function POST(request: NextRequest) {
  if (!allowedOrigin(request.headers.get("origin"))) {
    return refuse(403, "Uploads are only accepted from Quire's own pages.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return refuse(413, "That file is over 50 MB. Remove images, or paste the text instead.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, "That upload could not be read. Try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return refuse(400, "Choose a file to upload.");
  // paper: a draft of the paper this is a new version of; absent, the upload starts a paper of its own.
  const result = saveUpload(String(form.get("title") ?? ""), file.name, new Uint8Array(await file.arrayBuffer()),
    undefined, undefined, paperFromField(form.get("paper")));
  if ("error" in result) return refuse(400, result.error);
  revalidatePath("/drafts");
  return NextResponse.json({ id: result.id }, { status: 201 });
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dropzone } from "@/components/dropzone";
import { Button, InlineAlert, TextField } from "@/components/ui";
import { titleError, titleFromFile } from "@/lib/upload";
import { PaperPicker, type PaperChoice } from "../paper-picker";

// S04 file upload. XMLHttpRequest rather than fetch, because only it reports upload progress.
export function UploadForm({ papers }: { papers: PaperChoice[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0); // bumped after a successful upload, so the paper picker starts over

  const choose = (f: File) => {
    setFile(f);
    setError(null);
    if (!title.trim()) setTitle(titleFromFile(f.name));
  };

  const send = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return setError("Choose a file to upload.");
    const problem = titleError(title);
    if (problem) return setError(problem);
    const body = new FormData();
    body.set("file", file);
    body.set("title", title);
    body.set("paper", String(new FormData(event.currentTarget).get("paper") ?? "new"));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress((100 * e.loaded) / e.total);
    xhr.onload = () => {
      setProgress(undefined);
      if (xhr.status === 201) {
        // The draft is on its way: empty the box for the next one (the drafts page keeps this form mounted).
        setFile(null);
        setTitle("");
        setRound((r) => r + 1);
        router.push("/drafts");
        router.refresh();
        return;
      }
      try {
        setError(JSON.parse(xhr.responseText).error);
      } catch {
        setError(`The upload failed (HTTP ${xhr.status}). Try again.`);
      }
    };
    xhr.onerror = () => {
      setProgress(undefined);
      setError("The upload did not reach Quire. Is the app still running?");
    };
    setProgress(0);
    xhr.send(body);
  };

  const sending = progress !== undefined;
  return (
    <form onSubmit={send} className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {error && <InlineAlert variant="danger" title="That file can't be checked yet" live>{error}</InlineAlert>}
      <Dropzone onFile={choose} progress={progress} disabled={sending} file={file} />
      <TextField id="upload-title" name="title" label="Title" required maxLength={300}
        value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coral reef essay, draft 2" />
      <PaperPicker key={round} id="upload-paper" papers={papers} title={title} />
      <div>
        <Button type="submit" loading={sending} disabled={!file}>Check this file</Button>
      </div>
    </form>
  );
}

"use client";
// S04 intake: one pad sheet you paste the draft into, or drop a file onto (or pick one with Upload). The
// status line under the sheet says whether it is ready; the title fills itself from the file name or the
// text's first line until you edit it. Pasted text goes through submitPaste; a file goes to /api/upload
// with XMLHttpRequest, because only it reports upload progress.
import { useActionState, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload, X } from "lucide-react";
import { Button, InlineAlert, ProgressBar, TextField, cx } from "@/components/ui";
import { pasteStatus, titleFromText } from "@/lib/intake";
import { ACCEPT, checkUpload, shortFileName, titleError, titleFromFile } from "@/lib/upload";
import { submitPaste, type PasteState } from "../actions";
import { PaperPicker, type PaperChoice } from "../paper-picker";

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function IntakeSheet({ papers }: { papers: PaperChoice[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitPaste, {} as PasteState);
  const [text, setText] = useState(state.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [typedTitle, setTypedTitle] = useState<string | null>(null); // null until edited by hand
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const title = typedTitle ?? (file ? titleFromFile(file.name) : titleFromText(text));
  const status = pasteStatus(text);
  const sending = progress !== undefined || pending;
  const ready = file ? true : status.ready;

  const take = (f?: File) => {
    if (!f) return;
    const problem = checkUpload(f.name, f.size);
    setError(problem);
    if (!problem) setFile(f);
  };
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const onDragOver = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return; // dragged text drops into the sheet as usual
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };

  const upload = (form: HTMLFormElement) => {
    const problem = titleError(title);
    if (problem || !file) return setError(problem ?? "Choose a file to upload.");
    const body = new FormData();
    body.set("file", file);
    body.set("title", title);
    body.set("paper", String(new FormData(form).get("paper") ?? "new"));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress((100 * e.loaded) / e.total);
    xhr.onload = () => {
      setProgress(undefined);
      if (xhr.status === 201) {
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
    setError(null);
    setProgress(0);
    xhr.send(body);
  };

  const shown = error ?? state.error;
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form action={action} onSubmit={(e) => { if (file) { e.preventDefault(); upload(e.currentTarget); } }}
        className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {shown && <InlineAlert variant="danger" title={file ? "That file can't be checked yet" : "That can't be checked yet"} live>{shown}</InlineAlert>}

        <div onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}
          className={cx("sheet relative rounded-sm transition-colors", over && "outline-2 outline-offset-4 outline-dashed outline-accent")}>
          <div className="flex items-center justify-between gap-3 border-b border-border py-2 pr-3 pl-4 md:pl-16">
            <label htmlFor={file ? undefined : "draft"} className="text-sm font-semibold">{file ? "Your file" : "Your draft"}</label>
            {file ? (
              <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => { setFile(null); setError(null); }}>
                <X aria-hidden className="size-4" />Use text instead
              </Button>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={sending} onClick={() => picker.current?.click()}>
                <Upload aria-hidden className="size-4" />Upload a file
              </Button>
            )}
            <input ref={picker} type="file" accept={ACCEPT.join(",")} className="sr-only" tabIndex={-1} aria-hidden
              onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
          </div>

          {file ? (
            <div className="md:margin-rule flex min-h-72 items-center justify-center px-6 py-10 md:pl-16">
              <span className="settle flex min-w-0 max-w-full items-center gap-3 rounded-sm border border-border bg-surface px-4 py-3">
                <FileText aria-hidden className="size-7 shrink-0 text-accent" />
                <span className="min-w-0">
                  <span id="draft" className="block truncate font-semibold" title={file.name}>{shortFileName(file.name, 40)}</span>
                  <span className="block text-xs text-muted">{kb(file.size)} · read on this PC once you check it</span>
                </span>
              </span>
            </div>
          ) : (
            <textarea id="draft" name="text" value={text} onChange={(e) => setText(e.target.value)} autoFocus
              aria-describedby="draft-status" placeholder="Paste your draft here, or drop a Word, PDF, RTF, ODT or text file anywhere on this sheet."
              className="md:margin-rule block min-h-72 max-h-[min(60vh,40rem)] w-full resize-none overflow-y-auto bg-transparent px-4 py-5 font-serif text-doc [field-sizing:content] placeholder:text-muted focus:outline-none md:pr-8 md:pl-16" />
          )}

          {over && (
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-bg/85">
              <p className="flex items-center gap-2 font-semibold text-accent"><Upload className="size-5" />Let go to check this file</p>
            </div>
          )}

          <p id="draft-status" aria-live="polite"
            className="flex items-center gap-2 border-t border-border py-2 pr-3 pl-4 text-xs text-muted md:pl-16">
            <span aria-hidden className={cx("size-2 rounded-pill transition-colors",
              file || status.ready ? "bg-accent" : status.words > 0 ? "bg-warning" : "bg-border-input")} />
            {file ? `${file.name.split(".").pop()?.toUpperCase()} file · ${kb(file.size)} · ready` : status.note}
          </p>
        </div>

        {progress !== undefined && <ProgressBar value={progress} label="Uploading" />}

        <div className="grid gap-4 md:grid-cols-2">
          <TextField id="title" name="title" label="Title" required maxLength={300} value={title}
            onChange={(e) => setTypedTitle(e.target.value)} placeholder="Coral reef essay, draft 2"
            hint={typedTitle === null && title ? `From the ${file ? "file name" : "first line"}. Edit it if you like.` : undefined} />
          <PaperPicker id="paper" papers={papers} title={title} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" loading={sending} disabled={!ready}>Check this draft</Button>
          {!ready && <span className="text-sm text-muted">Add the draft first.</span>}
        </div>
      </form>

      <aside className="space-y-6 lg:sticky lg:top-20" aria-labelledby="next-heading">
        <div>
          <h2 id="next-heading" className="text-sm font-semibold">What happens next</h2>
          <ol className="mt-3 space-y-3 text-sm">
            {[
              ["Read", "The text comes out of the file, keeping equations, captions and the reference list."],
              ["Search", "Phrases go to a web search; pages sharing eight or more words in a row become sources."],
              ["Estimate", "A model on this PC scores the prose for AI-like writing, from 300 words up."],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                <span aria-hidden className="flex size-6 items-center justify-center rounded-pill border border-border-input font-mono text-xs text-muted">{i + 1}</span>
                <span><span className="font-semibold">{t}.</span> <span className="text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="border-t border-border pt-4 text-sm">
          <h2 className="font-semibold">Stays on this PC</h2>
          <p className="mt-1 text-muted">Only the short phrases used to search leave this computer.</p>
        </div>
        <div className="border-t border-border pt-4 text-sm">
          <h2 className="font-semibold">What it takes</h2>
          <p className="mt-1 text-muted">Word, PDF, RTF, ODT or plain text up to 50 MB, or pasted text up to 2 MB. At least 20 words.</p>
        </div>
      </aside>
    </div>
  );
}

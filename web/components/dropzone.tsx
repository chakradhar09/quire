"use client";
// Upload dropzone (components.md: Data). Same rules as /api/upload (lib/upload.ts); the server checks again.
// Dragging a file over it lifts the arrow; a chosen file settles onto the pad as a sheet.
import { useState } from "react";
import { FileText, Upload } from "lucide-react";
import { ACCEPT, checkUpload, shortFileName } from "@/lib/upload";
import { InlineAlert, ProgressBar, cx } from "./ui";

export function Dropzone({ onFile, progress, disabled, file }: { onFile: (f: File) => void; progress?: number; disabled?: boolean; file?: File | null }) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = (f?: File) => {
    if (!f) return;
    const problem = checkUpload(f.name, f.size);
    setError(problem);
    if (!problem) onFile(f);
  };
  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
        className={cx("relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
          over || progress !== undefined ? "border-accent bg-bg" : "border-border-input bg-surface hover:border-accent hover:bg-bg",
          disabled && "pointer-events-none")}>
        {file ? (
          <span key={file.name} className="settle flex min-w-0 max-w-full items-center gap-3 rounded-sm border border-border bg-bg px-4 py-3 text-left">
            <FileText aria-hidden className="size-6 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold" title={file.name}>{shortFileName(file.name, 30)}</span>
              <span className="block text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · choose another to replace it</span>
            </span>
          </span>
        ) : (
          <>
            <Upload aria-hidden className={cx("size-6 transition-[translate,color]", over ? "-translate-y-1 text-accent" : "text-muted")} />
            <span className="text-base font-semibold">{over ? "Let go to add it to the pad" : "Drop a file here or choose one"}</span>
            <span className="text-sm text-muted">Word, PDF, RTF, ODT or plain text, up to 50 MB</span>
          </>
        )}
        <input type="file" accept={ACCEPT.join(",")} disabled={disabled} className="sr-only"
          onChange={(e) => take(e.target.files?.[0])} />
      </label>
      {progress !== undefined && <ProgressBar value={progress} label="Uploading" />}
      {error && <InlineAlert variant="danger" title="That file can't be checked" live>{error}</InlineAlert>}
    </div>
  );
}

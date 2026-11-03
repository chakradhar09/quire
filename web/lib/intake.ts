// The intake sheet's live feedback, worked out in the browser as you type (no server imports).
// The server and worker still check: 2 MB here matches submitText, 20 words matches the worker's MIN_WORDS.

export const MIN_WORDS = 20;
export const MAX_PASTE_BYTES = 2 * 1024 * 1024;

export const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

export function pasteStatus(text: string): { words: number; ready: boolean; note: string } {
  const words = wordCount(text);
  if (new TextEncoder().encode(text).length > MAX_PASTE_BYTES) {
    return { words, ready: false, note: "Over 2 MB · paste a shorter part, or upload the file" };
  }
  if (words === 0) return { words, ready: false, note: "Paste your draft, or drop a file on the sheet" };
  const count = `${words.toLocaleString("en-GB")} word${words === 1 ? "" : "s"}`;
  return words < MIN_WORDS
    ? { words, ready: false, note: `${count} · at least ${MIN_WORDS} needed` }
    : { words, ready: true, note: `${count} · ready` };
}

// A title from pasted text: its first line with words in it, without a leading Markdown "#", cut at a word
// to stay under 80 characters.
export function titleFromText(text: string, max = 80) {
  const line = text.split(/\r?\n/).find((l) => /[\p{L}\p{N}]/u.test(l))?.replace(/^\s*#+\s*/, "").trim() ?? "";
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).trimEnd()}…`;
}

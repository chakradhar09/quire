// Upload rules, shared by the dropzone (instant feedback) and /api/upload (the real check).
// No server imports, so client components can use it.

export const ACCEPT = [".docx", ".pdf", ".rtf", ".odt", ".txt"];
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".txt": "text/plain",
};

// Cross-site form posts still carry Host: 127.0.0.1:3000, so the proxy's Host check misses them.
// Route handlers don't get Next's server-action origin check, so uploads check Origin themselves.
const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]);

export const allowedOrigin = (origin: string | null) => origin !== null && ALLOWED_ORIGINS.has(origin);

export const fileName = (name: string) => name.trim().split(/[\\/]/).pop() ?? "";

export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

// A name with no spaces ("Lab_Report_2_SoilErosionSurvey") was typed for a file system, so underscores,
// hyphens and camelCase become word breaks. A name with spaces is left as written.
export function titleFromFile(name: string) {
  const stem = fileName(name).slice(0, fileName(name).length - extensionOf(name).length).trim();
  const title = /\s/.test(stem) ? stem
    : stem.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return title.slice(0, 300);
}

export function titleError(title: string): string | null {
  const name = title.trim();
  if (!name) return "Give the draft a title.";
  if (name.length > 300) return "Keep the title to 300 characters or fewer.";
  return null;
}

export function checkUpload(name: string, size: number): string | null {
  if (!ACCEPT.includes(extensionOf(name))) {
    return `${name} is not a file type Quire can read. Use Word (.docx), PDF, RTF, ODT or plain text.`;
  }
  if (size <= 0) return `${name} is empty.`;
  if (size > MAX_UPLOAD_BYTES) return `${name} is over 50 MB. Remove images, or paste the text instead.`;
  return null;
}

// The paper a new draft belongs to, from a form field: a draft id of that paper ("12"). Empty, "new" or
// anything that is not a whole positive number means a paper of its own.
export function paperFromField(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\s*\d+\s*$/.test(value)) return undefined;
  const id = Number(value);
  return id > 0 ? id : undefined;
}

// A file name cut to at most `max` characters for a narrow box: the end of the name is replaced by an
// ellipsis and the extension stays, so "Lab_Report_2_SoilErosion.pdf" is still recognisably a PDF.
export function shortFileName(name: string, max: number) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}

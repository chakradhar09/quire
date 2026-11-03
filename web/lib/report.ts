// Pure helpers for the report UI. Checked by report.test.ts (npm test).

export type Band = "none" | "low" | "mid" | "high" | "max";

// Bands follow the whole number shown on the badge, so "0%" is never coloured and "25%" is never "low".
export function band(raw: number): Band {
  const score = Math.round(raw);
  if (score <= 0) return "none";
  if (score < 25) return "low";
  if (score < 50) return "mid";
  if (score < 75) return "high";
  return "max";
}

// Full class names, so Tailwind can see them. Index = band.
export const BAND_CLASS: Record<Band, string> = {
  none: "bg-score-none-bg text-score-none-text",
  low: "bg-score-low-bg text-score-low-text",
  mid: "bg-score-mid-bg text-score-mid-text",
  high: "bg-score-high-bg text-score-high-text",
  max: "bg-score-max-bg text-score-max-text",
};

// The AI estimate's bands, used by the list badge and the report header so one score is one colour
// everywhere. Under 50% stays in the AI's own blue; 50 to 79 and 80 and up borrow the similarity amber
// and orange, so the drafts most likely to be flagged stand out.
export type AiBand = "low" | "mid" | "high";

export const aiBand = (raw: number): AiBand => {
  const score = Math.round(raw); // the number shown
  return score >= 80 ? "high" : score >= 50 ? "mid" : "low";
};

export const AI_BADGE_CLASS: Record<AiBand, string> = {
  low: "bg-ai-bg text-text",
  mid: BAND_CLASS.mid,
  high: BAND_CLASS.high,
};

// Text colour alone, for the large header number: the text half of the badge pair.
export const AI_TEXT_CLASS: Record<AiBand, string> = {
  low: "text-ai-solid",
  mid: "text-score-mid-text",
  high: "text-score-high-text",
};

// One entry per source colour; rank 11 reuses colour 1.
export const MATCH = [
  { tint: "bg-match-1-bg", line: "border-match-1-solid", chip: "bg-match-1-solid", ring: "outline-match-1-solid" },
  { tint: "bg-match-2-bg", line: "border-match-2-solid", chip: "bg-match-2-solid", ring: "outline-match-2-solid" },
  { tint: "bg-match-3-bg", line: "border-match-3-solid", chip: "bg-match-3-solid", ring: "outline-match-3-solid" },
  { tint: "bg-match-4-bg", line: "border-match-4-solid", chip: "bg-match-4-solid", ring: "outline-match-4-solid" },
  { tint: "bg-match-5-bg", line: "border-match-5-solid", chip: "bg-match-5-solid", ring: "outline-match-5-solid" },
  { tint: "bg-match-6-bg", line: "border-match-6-solid", chip: "bg-match-6-solid", ring: "outline-match-6-solid" },
  { tint: "bg-match-7-bg", line: "border-match-7-solid", chip: "bg-match-7-solid", ring: "outline-match-7-solid" },
  { tint: "bg-match-8-bg", line: "border-match-8-solid", chip: "bg-match-8-solid", ring: "outline-match-8-solid" },
  { tint: "bg-match-9-bg", line: "border-match-9-solid", chip: "bg-match-9-solid", ring: "outline-match-9-solid" },
  { tint: "bg-match-10-bg", line: "border-match-10-solid", chip: "bg-match-10-solid", ring: "outline-match-10-solid" },
] as const;

export const matchColour = (rank: number) => MATCH[(rank - 1) % MATCH.length];

export type Span = { id: string; start: number; end: number; rank: number };
export type Segment = { start: number; end: number; span: Span | null };

// Cut [0, length) into runs. Where spans overlap, the best rank (lowest number) wins,
// which mirrors the scoring rule: each word belongs to the top-ranked source covering it.
// ponytail: O(cuts x spans), fine for hundreds of matches; sweep line if a report ever has thousands.
export function segments(length: number, spans: Span[]): Segment[] {
  const clamp = (n: number) => Math.max(0, Math.min(length, n));
  const cuts = new Set([0, length]);
  for (const s of spans) {
    cuts.add(clamp(s.start));
    cuts.add(clamp(s.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    let best: Span | null = null;
    for (const s of spans) {
      if (s.start <= a && s.end >= b && (!best || s.rank < best.rank)) best = s;
    }
    const prev = out[out.length - 1];
    if (prev && prev.span === best) prev.end = b;
    else out.push({ start: a, end: b, span: best });
  }
  return out;
}

// Paragraph ranges of a text split on newlines, skipping empty lines.
export function paragraphs(text: string): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    if (line.trim()) out.push([pos, pos + line.length]);
    pos += line.length + 1;
  }
  return out;
}

// How a DOCX looks (worker/extract.py, _Layout): blocks in order, each pointing at its text in the draft
// by [start, end]. Pictures are files served by /documents/{id}/media/{src}.
export type Range = [number, number];
export type LayoutBlock =
  | { t: "title" | "h1" | "h2" | "h3" | "h4" | "p" | "li" | "caption"; r: Range; align?: "center" | "right" }
  | { t: "table"; rows: { r: Range; span?: number }[][] }
  | { t: "img"; n: number; src: string; w: number | null; ocr: Range[] }
  | { t: "box" | "chart"; lines: Range[] };

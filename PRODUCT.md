# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person, the owner, on their own PC. They check their own drafts (research papers, IEEE-format conference papers, essays) before handing them in, to see which passages match published or web sources and how much reads as AI-written. They use it at any time of day; the interface follows the OS light or dark theme.

## Product Purpose

Quire is a personal clean-room rebuild of Turnitin's similarity and AI-writing checks. A draft goes in (upload or paste), a local worker extracts the text, searches the web for overlapping passages, and runs a local AI-writing classifier. Success is the owner knowing, before submission, exactly which sentences would be flagged and why, and fixing them.

## Positioning

Everything runs on the owner's machine: no account, no institution, no submission repository, no upload to a third-party checker. The report shows the same kinds of evidence an instructor's report would (similarity score, ranked sources, highlighted matches, AI-writing estimate) to the writer first.

## Operating Context

- Screens: drafts list (S03), check a draft by upload or paste (S04), similarity report with ranked sources, side-by-side compare, filters and exclusions (S07–S12), AI-writing report (S14), component sandbox (`/design`).
- Live status: pages re-render from the server every 3 s while a draft is being read or checked; there is no status API.
- The worker (`worker/`, `python main.py`) must be running for checks to progress; the UI says so when it is not.
- Spec lives in `replica/` (recon, features, architecture, schema, design tokens and component specs).

## Capabilities and Constraints

- Next.js 16 (App Router, server components), React 19, Tailwind 4, Radix primitives, lucide-react icons. No other UI dependencies today.
- Single user, local only: no auth, no hosting, no sign-in, no sharing features.
- Similarity: web search based; sources ranked; matches of 8+ words; exclude source or match; filters for quotes, reference list, small sources.
- AI estimate: shown only on 300+ words of English prose; scores under 20% are hidden as unreliable; always labelled an estimate, not proof.
- Integrity flags (hidden text, swapped characters) and reused figures across the owner's uploads.

## Brand Commitments

- Name: Quire (wordmark only, no logo yet).
- Copy voice: plain, specific, second person, no hype; never Turnitin's wording.
- Colour is never the only signal: scores show the number, highlights carry a source number or label, states carry text.

## Evidence on Hand

Real drafts in the local database (the owner's own research papers). No testimonials, customers or benchmarks exist and none may be invented.

## Product Principles

1. The draft is the subject: the owner's own text, with evidence laid on it, leads every report.
2. Show the evidence, then the number: a score without the passages behind it is useless.
3. Honest uncertainty: the AI estimate always carries its caveats and calibration.
4. Live, not polled-looking: work in progress should read as work happening.

## Accessibility & Inclusion

WCAG AA contrast, visible focus on every control, keyboard paths for every action, `prefers-reduced-motion` respected.

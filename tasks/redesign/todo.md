# Redesign todo: the Computation Pad

Direction: **The Computation Pad** (chosen from re-roll 1, `seed:43273dcab1369b17`). Replaces the Examination Bench (`DESIGN.md` describes the Bench until T7 rewrites it). Product truth: `PRODUCT.md`. Milestone 2's plan stays in `tasks/plan.md` and `tasks/todo.md`; other sessions append notes there, so this plan lives apart.
Built in the main session (subagents are off, see `CLAUDE.md`). One task per `/build`, each its own commit; stage the task's files by path, never `git add -A`.
Web checks = from `web/`: `npm test`, `npx tsc --noEmit`, `npx eslint`, plus `npm run build` when routes change. Worker checks = from `worker/`: `.venv\Scripts\python -m unittest discover -p "*_test.py"`. Design checks: `python replica/design/contrast.py` on both token files; `impeccable detect --json web/app web/components`.
Scope the user chose: replace the look; organise by paper; the report as a to-resolve list; one report with similarity and AI as overlays; a document pane that scrolls by itself with a custom scrollbar; purposeful motion; a professional finish.

## Phase 1: Structure the data

- [x] **T1: Papers, resolutions and worker state (data layer, no visible change)**
  - `db/migrations/004_resolutions.sql`: table `resolutions` (document, kind `match` or `ai`, text range, state `cited`, `rewritten` or `kept`), unique per range; the schema refuses a match "kept" and an AI passage "cited". Schema version 4.
  - `web/lib/db.ts`: `submitText` and `saveUpload` take an optional `paper` (any draft of it) and attach the new draft as its newest version; `moveToPaper(id, paper|null)` never makes a cycle; `getResolutions`, `setResolution` (null undoes); `workerState()` returns idle, working or stalled plus the queue length; `Draft.parentId`.
  - `web/lib/papers.ts`: `groupPapers`, `titleStem`, `suggestPaper`.
  - Acceptance: a new version joins the newest end of its chain whichever draft names the paper; moving a draft into its own chain is refused; a resolution can be set, replaced and undone and nonsense states are refused; `workerState` is idle with no jobs, working with fresh ones, stalled when a queued job is over a minute old.
  - Verify: web and worker checks; each new test shown to fail when its behaviour is broken.
  - Files: `db/migrations/004_resolutions.sql`, `web/lib/db.ts`, `web/lib/db.test.ts`, `web/lib/papers.ts`, `web/lib/papers.test.ts`.

## Phase 2: The Pad's design system

- [x] **T2: Tokens, fonts and base components**
  - `replica/design/tokens.json` values change, names stay (the builder's rule); light is pale green quad ground, bottle-green bar, ink, margin red for what is open, blue for AI; dark follows the OS and is composed, not inverted. New names only where the Pad needs them (the open-rule red, the quad line).
  - Fonts from the chosen sketch: Public Sans (interface), Literata (the draft), Red Hat Mono (entry numbers and readouts). The quad grid shows only around the document sheet; one cell is the 8px spacing unit.
  - State is carried by line form as well as colour: open is a solid underline, resolved a single strike, excluded dotted.
  - Restyle header, buttons, fields, badges, status pills, empty state and the `/design` sandbox. Bench-only pieces (the lamp sweep, lime) are retired in T6 when their replacement exists, so each slice builds.
  - Motion tokens (Snappy personality): `--dur-fast` 100ms (hover, press), `--dur-base` 180ms, `--dur-slow` 250ms, exits half the entrance; ease-out in, ease-in out. Only `transform` and `opacity` animate; nothing animates when a working screen loads.
  - Dark theme is derived from the light values with a contrast check, not hand-picked twice (the Linear approach); skeleton rows instead of spinners; visible focus ring everywhere; an empty state written per screen.
  - References (read only, copy nothing): the Linear, Vercel and Raycast `DESIGN.md` files in `VoltAgent/awesome-design-md` for density and token structure. No design skill is installed (we have Impeccable, frontend-designer and the motion skills); `arhamhi/oxfords` `SKILL.md` may be read for restraint rules.
  - Acceptance: `contrast.py` reports 0 failing on both themes; every page renders at 320, 768, 1024 and 1440 with no sideways scroll; the detector is clean.
  - Files: `replica/design/tokens.json`, `replica/design/build_tokens.py`, `web/app/{layout,globals,tokens,theme}.css|tsx`, `web/components/{ui,score,overlays,dropzone}.tsx`, `web/app/design/page.tsx`.

### Checkpoint CP1: the look
- [ ] Web and design checks pass; the user looks at home, report and sandbox in light and dark.

## Phase 3: Papers and the report

- [x] **T3: Papers home and the worker light**
  - `/` lists papers (`groupPapers`): newest version's two scores, a strip of dated version entries, the change since the version before ("AI 96 to 72"). Being-checked panel, failure notes and delete stay. "Move to paper" on a version, through a menu.
  - Header worker light from `workerState` (idle, working, stalled with the fix).
  - One shared AI banding (moved out of `score.tsx` into `lib/report.ts`, tested) used by the list and the report header, so 96% is the same colour in both.
  - Version stack: a paper's versions drawn as offset sheets in CSS 3D (`perspective`, `translateZ`) that fan out on hover; flat offset stack on touch and under `prefers-reduced-motion`. No WebGL, no three.js.
  - Version entries settle in (6px rise and fade, 160ms, 40ms stagger, capped) only when a new version arrives, not on page load.
  - Acceptance: your three versions of one paper show as one paper with three entries; a stalled worker shows the start command; list and report agree on every AI colour.
  - Files: `web/app/page.tsx`, `web/components/{drafts-table,ui,score}.tsx`, `web/lib/report.ts`, `web/lib/report.test.ts`, `web/app/actions.ts`.

- [x] **T4: The report: one page, two overlays, a to-resolve list, a document that scrolls by itself**
  - One page per version; layer toggles for Similarity and AI writing, each on or off. `/documents/[id]/ai` redirects into it.
  - The document pane is its own scroll area (viewport height minus the header; the page does not scroll). Custom scrollbar: a draggable thumb and a track that carries a tick per match (position from the text offset, length from the passage, colour from the source), click to jump; wheel, keyboard and touch scrolling stay native.
  - To-resolve list in document order: a match offers Quote and cite, Rewrite, Exclude; an AI passage offers Rewrite, Keep. A resolved item is struck once and labelled, never removed; progress reads "N of M"; every decision can be undone; saved with `setResolution`.
  - Below `lg` the list sits under the document.
  - Our own scrollbar component (about 80 lines, native scrolling kept); `KingSora/OverlayScrollbars` (MIT) is the fallback only if touch or cross-browser behaviour fails.
  - Keyboard-first resolving: `j`/`k` step through items, `c` cite, `r` rewrite, `e` exclude, `p` keep an AI passage as written (`k` is taken by navigation), `z` undo; shortcuts shown on the focused item, ignored while typing.
  - Motion: resolving draws a strike line left to right (180ms) and the progress bar and "N of M" update; a tick or list click smooth-scrolls then pulses an outline on the passage once (400ms); layer toggles cross-fade the overlay (150ms). `motion@14.3.0` (MIT) only if the list's presence or reorder cannot be done in CSS.
  - Acceptance: scrolling the document moves the thumb and never the page; a tick jumps to its passage; a decision survives reload and a rescore; the open count leads the list; every shortcut works and is undoable.
  - Files: `web/app/reports/[id]/{page,report-view}.tsx`, `web/app/documents/[id]/ai/page.tsx`, `web/app/actions.ts`, `web/components/{report,exhibit-header}.tsx`, a new scrollbar component.

### Checkpoint CP2: the report
- [ ] Web and design checks pass; in the browser on a real report: every action, the scrollbar by mouse and keyboard, 375 px.

## Phase 4: Put drafts into papers, then finish

- [x] **T5: Upload and paste into a paper**
  - A paper picker on both forms, suggested from the title (`suggestPaper`), default "New paper"; `paper` passes through `submitPaste` and `/api/upload`.
  - Acceptance: uploading "Research_Paper_v4" offers the Research Paper chain and attaches as its newest version; choosing "New paper" starts a chain.
  - Files: `web/app/submit/*`, `web/app/page.tsx`, `web/app/actions.ts`, `web/app/api/upload/route.ts`, `web/components/dropzone.tsx`.

- [x] **T6: Landing page and motion**
  - Landing rebuilt in the Pad's world; its demo shows a match being struck and cited, on a document sheet that tilts in CSS perspective (hero only; static under reduced motion).
  - Motion explains state only: a match struck as it resolves, progress filling, a version entry settling in, checking steps advancing, route transitions kept, `prefers-reduced-motion` gives fades in place. CSS first; `motion@14.3.0` (MIT, over two weeks old) only if the to-resolve list needs presence or reorder animation CSS cannot do.
  - Retire the lamp sweep, lime and the count-up on every visit.
  - Acceptance: nothing animates on load of a working screen; reduced motion shows every state without movement.
  - Files: `web/app/welcome/page.tsx`, `web/components/{lamp-demo,count-up}.tsx`, `web/app/globals.css`.

- [x] **T7: Documents and review**
  - Replace the surface brief's direction contract; rewrite `DESIGN.md` and `.impeccable/design.json` from the build; rerun the home critique and close its snapshot if the priorities are cleared; in-thread finish review (`degraded/finish-reviewer.md`); `replica/design/components.md` brought into line.
  - Check `DESIGN.md` against the `google-labs-code/design.md` format spec (tokens in front matter, rationale in prose) and conform where cheap.
  - Acceptance: every claim in `DESIGN.md` is true of the build; detector, contrast, tests and types are clean.

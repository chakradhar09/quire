---
name: Quire
description: The computation pad. Every flagged passage is a line of working to resolve, struck through once handled, never erased.
colors:
  pad-green: "#e8efe3"
  quad-line: "#d3dfcc"
  sheet: "#fbfcf8"
  surface: "#f2f6ee"
  surface-sunken: "#e0e9da"
  hairline: "#c7d5bf"
  input-edge: "#62775f"
  ink: "#14211a"
  ink-muted: "#4b5e52"
  ledger-green: "#1d5e3e"
  ledger-green-deep: "#154a30"
  on-accent: "#ffffff"
  focus: "#1f7a4d"
  margin-red: "#b8321f"
  bottle-green: "#123a2b"
  on-bar: "#eff7f0"
  on-bar-muted: "#a6c4b3"
  highlighter: "#f1d36b"
  carbon-blue: "#1d44a6"
  carbon-blue-tint: "#d9e5fb"
  match-1: "#b42318"
  match-2: "#a34100"
  match-3: "#7a5600"
  match-4: "#17703f"
  danger: "#b3261e"
  warning: "#7a5200"
  night-pad: "#0e1712"
  night-sheet: "#15221b"
  night-bar: "#17402f"
  night-ink: "#e6f0e8"
  night-green: "#6fd09a"
  night-red: "#ff8f7e"
typography:
  hero:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  section:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "32px"
  heading:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  small:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  draft:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: "32px"
  readout:
    fontFamily: "Red Hat Mono, ui-monospace, monospace"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: "48px"
  entry-number:
    fontFamily: "Red Hat Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.05em"
rounded:
  sm: "2px"
  md: "3px"
  lg: "4px"
  pill: "999px"
spacing:
  unit: "4px"
  quad: "8px"
  gutter: "16px"
  gutter-md: "32px"
  panel: "20px"
  section: "80px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-green}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.ledger-green-deep}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "40px"
  button-on-bar:
    backgroundColor: "{colors.on-bar}"
    textColor: "{colors.bottle-green}"
    rounded: "{rounded.md}"
    height: "32px"
  button-on-bar-hover:
    backgroundColor: "{colors.on-bar-muted}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "40px"
  dropdown-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    padding: "20px"
  pad-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.draft}"
    rounded: "{rounded.sm}"
  header:
    backgroundColor: "{colors.bottle-green}"
    textColor: "{colors.on-bar}"
    height: "56px"
  score-badge:
    typography: "{typography.small}"
    rounded: "{rounded.sm}"
    height: "28px"
---

# Design System: Quire

## Overview

**Creative North Star: "The Computation Pad"**

Quire looks like the pad you check your working on. The ground is pale green paper ruled in 8px squares, with a darker line every four. A bottle-green bar runs across the top of every screen. The draft is a sheet laid on the pad, set in a book serif with a red margin rule down its left. Checking a draft means working down its flagged passages like lines of working: each one is open (underlined in margin red) until you quote and cite it, rewrite it, exclude it or keep it, and then it is struck through once and labelled, never erased. Similarity and AI writing are two overlays on the same sheet, not two reports.

Working screens (papers, intake, the report) are quiet and dense: hairlines, small radii, numbers in mono, colour kept for evidence. The landing page is the one place that persuades, with a tilted demo sheet resolving its matches. Light and dark both ship and follow the system setting. Dark is the same pad at night, generated from the light values (`replica/design/build_tokens.py`) until every contrast pair passes, never hand-picked twice.

Tokens live in `replica/design/tokens.json` and are generated into `web/app/tokens.css` and `theme.css`. Components use the Tailwind names (`bg-bench`, `text-muted`, `bg-shell`, `text-rule`), never raw hex.

**Key Characteristics:**
- Quad-ruled pad ground around a serif sheet with a red margin rule.
- Bottle-green bar; one bright green for actions and done.
- Open passages underlined in margin red; resolved ones struck through, not removed.
- Papers grouped as chains of versions, each version keeping its entry number (No. 013).
- Pages open still; motion marks only a change of state, plus one demo in the landing hero.

## Colors

A paper-and-ink palette in greens, with two signal colours (margin red, carbon blue) and ten evidence hues kept off the chrome.

### Primary
- **Bottle Green** (bar): the header on every screen. It owns a whole band, not an accent.
- **Ledger Green** (accent): primary buttons, the active tab underline, done checks, entry numbers, the progress fill, focus. In dark mode it lifts to a light green with dark text on it.

### Secondary
- **Margin Red** (rule): the sheet's margin rule and the underline of every passage still open. It means "not handled yet" and nothing else.
- **Carbon Blue** (AI): the AI writing overlay, the AI badge under 50%, AI readouts. Its tint marks AI passages on the sheet.

### Tertiary
- **Highlighter Yellow**: on the bar only. The current page's underline, the rule in the wordmark, the worker light while it works.

### Neutral
- **Pad Green** ground with **Quad Line** ruling: the report's document canvas and the landing hero only; the papers and intake pages sit on plain Bench; cards and sheets stay solid on top of it.
- **Sheet**: panels, cards, the draft. **Surface** and **Surface Sunken** for quiet fills and empty tracks.
- **Ink** and **Ink Muted** for text; **Hairline** for dividers and card edges; **Input Edge** for field borders.

### Evidence
Ten source hues (`match-1` to `match-10`, each a tint and a solid) mark matched passages, their tick marks on the scrollbar and their source dots. Similarity badges use five bands (none, low, mid, high, max); the AI badge stays carbon blue under 50%, then borrows the similarity amber (50 to 79) and orange (80 and up).

### Named Rules
**The Evidence Colour Rule.** Source hues and carbon blue appear only on evidence: highlights, scrollbar ticks, source dots, the AI mark and its badges. Chrome stays green, ink and sheet.

**The Margin Red Means Open Rule.** Margin red is the colour of unfinished work. It is never decoration and never an error colour (errors use danger).

**The Shown Number Rule.** A badge's colour comes from the whole number it shows, so "0%" is never coloured and "25%" is never low.

## Typography

**Display Font:** Public Sans (with system-ui)
**Body Font:** Public Sans (with system-ui)
**Draft Font:** Literata (with Georgia)
**Label/Mono Font:** Red Hat Mono (with ui-monospace)

**Character:** a plain, sturdy public-information sans for the interface, so the draft in its book serif reads as the subject, and a mono only where something is measured or numbered.

### Hierarchy
- **Hero** (800, clamp 2.5 to 4.25rem, 1.02): landing headlines only.
- **Section** (800, clamp 1.75 to 2.5rem, 1.15): landing section headings.
- **Title** (700, 28px, 32px): page titles ("Papers", "Check a draft").
- **Heading** (600, 20px, 28px): card and panel headings.
- **Body** (400, 16px, 24px) and **Small** (400, 14px, 20px): interface text, hints, list meta.
- **Label** (500, 12px, 16px): captions, status lines, and uppercase group labels with 0.05em tracking.
- **Draft** (400, 18px, 32px): the draft on its sheet, every quoted passage, the paste box.
- **Readout** (600, 44px, mono): the two numbers in a report header.
- **Entry number** (500, 12px, mono, 0.05em): "No. 013", wherever a draft is named.

### Named Rules
**The Mono Measures Rule.** Mono is for numbers that are data (scores, entry numbers, word counts, counters), never for headings or decoration.

## Layout

The quad cell (8px) is the spacing unit, on a 4px base. Content is capped at 1280px with 16px gutters on phones and 32px from md. Breakpoints: 640, 768, 1024, 1280.

- **Papers:** the list of paper cards beside the intake panel (20rem at lg, 380px at xl). Below lg the panel follows the list, and a "Check a draft" button jumps to it.
- **Intake:** one pad sheet with its title and paper fields under it, beside an 18rem side panel. Below lg the panel follows.
- **Report:** at lg and up the page does not scroll. The sheet (max 760px) scrolls in its own pane beside the 380px to-resolve list. Below lg the list sits under the sheet.
- **Landing:** hero split 5:6 (text, demo) at lg; sections at 80px vertical rhythm.
- **Header:** 56px. On phones the wordmark and the worker light's words go to screen readers, so nothing makes a page wider than 320px.

## Elevation & Depth

Flat by default: hairlines separate everything. Two shadows exist, plus one piece of real 3D.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 0 rgba(20,33,26,.06)`): the sheet and panels resting on the pad.
- **Pop** (`box-shadow: 0 18px 40px -12px rgba(20,33,26,.35)`): dialogs, menus, the dropdown sheet, toasts, the landing demo sheet.

### Named Rules
**The Paper Depth Rule.** Depth is paper on paper: sheets lie flat with a card shadow; only things that float above the pad (menus, dialogs) get the pop shadow. No glow halos, no glass.

The **version stack** is up to three sheets offset like a small pile; hovering the card marks the top sheet's edge in the accent. The landing demo sheet is the one 3D element: tilted in perspective, it straightens under the pointer, and lies flat under reduced motion.

## Shapes

Small, papery radii: 2px for chips, badges and the sheet, 3px for buttons, inputs and the dropdown, 4px for panels and cards, full pills for status dots and source dots. Underlines, strikes and the margin rule are square-ended lines. Dashed outlines mark drop targets and hidden text.

## Components

### Buttons
- **Shape:** gently squared (3px). Sizes 32, 40 and 48px.
- **Primary:** ledger green with white text (dark mode: light green with dark text). Hover deepens.
- **Secondary:** sheet with an input-edge border; **ghost** is text only with a surface hover; **danger** for delete.
- **On the bar:** pale on-bar with bottle-green text; hover goes to on-bar muted, which keeps the text above 6:1 in both themes.
- **Press:** all scale to 98%. Loading keeps the label and adds a spinner.

### Score badges and readouts
Mono numbers on their band colour, 28px tall in lists, larger in headers. The AI badge carries a bold "AI" label. Under 20% it shows a muted `*` (too unreliable to show), explained under the list. The report header shows the two readouts at 44px.

### Inputs / Fields
- **Style:** sheet fill, input-edge border, 3px radius, 40px tall. Label above, hint or error below, linked for screen readers.
- **Focus:** a 2px focus-green outline with a 2px offset, the one focus style everywhere.
- **Paste box:** grows with what is typed up to 60% of the screen (40rem at most), then scrolls inside itself.
- **Dropdown:** a custom list on a pad sheet (never the system's own). Titles wrap to two lines, each with its entry number beneath, a "Suggested" tag where the title points to a paper, labelled groups, a check on the chosen item. The arrow turns while it is open. It submits with its form like a native select.

### Navigation
Bottle-green bar, 56px. The wordmark mark is a small sheet with a highlighter rule and leads home. Links: Home (the landing, `/`, the default page), Drafts (the papers, `/drafts`), Design. Links are on-bar muted, and the current page is on-bar with a 2px highlighter underline. The worker light is also the queue: with nothing queued it is a quiet status line; while drafts are being read or checked it is a button with a breathing highlighter dot and a count, whose hover preview lists each draft and its current step and whose click opens a dialog with every draft's full checking sequence (stalled turns it warning-coloured with the command to start the worker). On the landing page the bar is hidden over the hero and slides in once the hero has gone. Its "Check a draft" hides while the page's own closing call to action is on screen.

### Paper card (signature)
Above the list, a search (every version's title and entry number, as you type) and a sort (newest, highest AI writing, highest similarity, title). One card per paper: the version stack, the entry number centred beside the title (however many lines it wraps to), the date and version count, both badges, the change since the version before ("AI writing 96% → 72%"), and the earlier versions as dated rows in a sunken strip.

### The pad sheet and the to-resolve list (signature)
The draft sits on the quad ground as a sheet with a red margin rule. Matches are tinted in their source colour with a 2px underline and a numbered chip on the first span; AI passages in carbon blue. Resolved passages keep their mark, lighter and struck through. A custom scrollbar beside the sheet carries a tick for every passage at its place in the text: click to jump. The list beside it runs in reading order. Each item offers its actions (Quote and cite, Rewrite, Exclude for matches; Rewrite, Keep for AI passages), and a decision draws a strike through the snippet and labels it. Every decision can be undone, and progress reads "N of M resolved". Keys: j and k move, c cite, r rewrite, e exclude, p keep, z undo.

### Intake sheet (signature)
One sheet you paste into, or drop a file anywhere on, with "Upload a file" in its top bar. A status line under it counts words live ("12 words · at least 20 needed", "334 words · ready"). The title fills itself from the file name or the first line until you edit it.

### Checking sequence
A miniature sheet whose lines are written in as each step finishes, beside the three steps (reading, searching, estimating), each done, running (a breathing dot), next, failed or not run.

### Entrances and state changes
When several things move together they run in a chain (`web/lib/motion.ts`): each move starts at a point partway through the one before, with a short hold before the key move. The rhythms are tokens:
- **standard** and **expressive** (IBM Carbon) for things moving or drawing across;
- **enter** and **exit** (Material 3 emphasized) for arriving and leaving;
- **settle** and **anticipate**, small overshoots kept to a few percent, for the one landing that matters in a sequence.

Pages open still: everything is on screen from the first paint, with no entrance and nothing waiting to scroll into view (content held back by an animation shows as a blank page whenever the animation does not run). Motion marks only a change: a strike drawing through, progress filling, a new version arriving, a dialog opening. The one exception is the landing hero's sample sheet, which resolves its three matches in a chained sequence. Exits are faster than entrances. Under reduced motion every state still shows, as short fades in place.

### Named Rules
**The Struck Not Erased Rule.** A flagged passage is never removed once handled. It stays, struck through once and labelled with what was done, and it can be undone.

**The One Offer Rule.** The same action is never offered twice on one screen at once: the header drops "Check a draft" where the page has its own intake, and over the landing hero.

**The Still Page Rule.** A page never waits on motion to show its content. When several things do move together (the hero demo, a resolution), each is timed from the one before it, and the sequence has one payoff.

## Do's and Don'ts

### Do:
- **Do** give every draft its entry number (No. 013) wherever the draft is named.
- **Do** show the passages behind every number; a score never appears without a way to its evidence.
- **Do** keep the AI estimate's caveats next to it.
- **Do** strike resolved work through and keep it listed, with an undo.
- **Do** cut or wrap long titles and file names inside their box (keep a file's extension visible); wrap titles at their own separators (underscore, dot, slash, hyphen) before breaking inside a word, and keep labels centred on wrapped text.
- **Do** keep motion for changes of state, timed with the chain helpers and a named rhythm; fall back to fades under reduced motion.

### Don't:
- **Don't** put source hues or carbon blue on chrome, buttons or headings.
- **Don't** use margin red for anything but open work.
- **Don't** add glow halos, gradient text or glass.
- **Don't** put a label or kicker above a heading; the entry number is the one label, and it is data.
- **Don't** let an input grow without a limit, or let anything make the page wider than the screen.
- **Don't** show the system's own dropdown list; use the pad-sheet dropdown.
- **Don't** offer the same button twice on one screen.

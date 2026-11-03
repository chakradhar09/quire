# Components: Quire

Every repeated part from `recon.md`, plus the base parts every screen needs. Tokens are the Tailwind names generated from `tokens.json` (`bg-surface`, `text-muted`, `rounded-md`, `text-doc`). No raw hex in components.

How this was made: recon used public docs only, so there were no screenshots to measure. Roles, states and screen use come from the recon map. Brought in line with the built Computation Pad on 2026-11-02 (redesign T7); `DESIGN.md` at the project root is the visual system, this file is the parts list. All copy below is new; none of it is Turnitin's wording.

Rules for every component:

- Focus: `focus-visible` shows a 2px `focus` ring with a 2px offset. Never remove the outline without that ring.
- Motion: timed in chains with the rhythm tokens (`web/lib/motion.ts`: `chain`, `cascade`, `enter`, `transit`; rhythms standard, expressive, enter, exit, settle, anticipate). Hover and press use `duration-fast`. Everything respects `prefers-reduced-motion` (no slide or spin, short fades in place).
- Colour is never the only signal: scores always show the number, highlights always have a source number or label, states always have text.
- Icons: Lucide (`lucide-react`, ISC licence), 16px in text, 20px in buttons, `aria-hidden` unless the icon is the only label.
- Accessible base: Radix (`radix-ui`) for Dialog, DropdownMenu, Select (the Dropdown), Tabs, Switch, Tooltip, Toast. Native elements for everything else.
- Built in isolation at `/design` (`web/app/design/page.tsx`) before any screen.

## Base

```
Button
  variants  primary, secondary, ghost, danger, shell (on the bar), shellGhost
  sizes     sm 32px, md 40px, lg 48px; icon-only square of the same heights
  states    default, hover, active, focus-visible, disabled, loading
  tokens    primary: bg accent, hover accent-hover, text on-accent
            secondary: bg bg, border border-input, text text, hover surface
            ghost: transparent, text text, hover surface
            danger: bg danger, text on-accent
            shell: bg on-shell, text shell, hover on-shell-muted (keeps the text above 6:1)
            radius md, text sm/600, gap 2 between icon and label; press scales to 98%
  a11y      real <button>; loading sets aria-busy, disables, keeps the label and adds a spinner;
            icon-only needs aria-label
  used on   all

Text input / Textarea / Field
  variants  text, number with unit suffix, textarea (paste box)
  sizes     md 40px; textarea min 240px tall, grows with its text up to 60vh (40rem), then scrolls inside
  states    default, hover, focus-visible, disabled, invalid, read-only
  tokens    bg bg, border border-input, radius md, text base; invalid: border danger + message in danger
  a11y      <label for>, hint and error linked with aria-describedby, aria-invalid on error;
            the error message says what to do ("Enter a number from 0 to 1000")
  used on   S01, S04, S11, S03 search

Checkbox
  states    unchecked, checked, indeterminate, focus-visible, disabled
  tokens    border border-input, checked bg accent + check on-accent, radius sm
  a11y      native <input type="checkbox"> styled, label is clickable
  used on   S12 restore list, S03 row select (could)

App header
  parts     wordmark (sheet mark with a lamp rule + name, links to /), nav: Home (/), Drafts (/drafts), Design;
            worker light, which
            is the queue button while drafts are unfinished (hover: preview of each draft and its step;
            click: dialog with every draft's checking sequence; it keeps the page refreshing meanwhile);
            "Check a draft" (left out where the page has its own intake)
  variants  sticky (working screens); autohide (landing: hidden over #hero, slides in after it,
            and its "Check a draft" hides while #cta-end is on screen)
  tokens    height 56px, bg shell, text on-shell; links on-shell-muted, current page on-shell with a
            2px lamp underline; below sm the name and the worker light's words are sr-only
  a11y      <header>, <nav aria-label="Main">, current page aria-current="page"; skip link to main;
            the autohide header shows while focus is inside it; the worker light is role="status"
  used on   all

Empty state
  parts     a blank pad page (ruled lines, red margin rule), one-line title, one sentence, optional action
  tokens    text-muted body, centred, padding 12
  copy      S03 "Nothing on the pad yet" / "Drop a file into the panel, or paste your text, and the first
            check starts as soon as it has been read."
            S17 "Your library is empty" / "Add old drafts or readings and new checks will compare against them."
            S12 "Nothing excluded" / "Sources you exclude from this report show up here."
            S13 "No integrity flags" / "No hidden text or swapped characters were found."
  used on   S03, S08, S12, S13, S17

Skeleton
  tokens    bg surface-sunken, radius sm; pulse is opacity only, off with reduced motion
  a11y      container aria-busy="true"; skeleton blocks aria-hidden
  used on   S03 loading, S07 loading, S14 loading
```

## Feedback

```
Inline alert
  variants  info, success, warning, danger
  tokens    bg {variant}-surface, text text, icon and title in {variant}, radius md, padding 3 4
  a11y      danger and warning use role="alert" only when they appear after an action;
            static notices are plain text. Never auto-dismiss.
  copy      S04 rejections: "This PDF has no selectable text. Export it again with text, or paste the text instead."
            S14 disclaimer: "This score is an estimate from an open model. It can be wrong in both directions and is not proof of anything."
  used on   S04, S14, S11

Toast
  variants  success, error
  states    entering, visible, leaving
  tokens    bg text (inverted), text bg, radius md, shadow pop; bottom right, bottom centre on mobile
  a11y      Radix Toast: aria-live polite (error: assertive), 5 s, pauses on hover and focus,
            has a close button; never the only place an error is shown. With Undo (Toast.Action,
            altText "Undo"), 8 s: the action becomes final only when the toast goes
  used on   all (settings saved, source excluded, upload failed); drafts page delete: "Deleted “title”" + Undo

Progress indicator
  variants  determinate bar (upload), indeterminate (processing), spinner (inline)
  tokens    track surface-sunken, bar accent, height 6px, radius pill; the known bar fills by scaleX
            (transform only), the unknown one travels the track
  a11y      <progress> or role="progressbar" with aria-valuenow for determinate;
            indeterminate has aria-label ("Checking for matches"); spinner stops under reduced motion
  used on   S03, S04

Status pill
  variants  processing, recalculating, queued, waiting-for-worker, error, rejected
  tokens    processing/queued: info on info-surface; waiting: warning on warning-surface;
            error/rejected: danger on danger-surface; text xs/500, radius pill, padding 1 2
  a11y      text label always present; S03 row status changes are announced through one
            aria-live="polite" region, not per pill
  used on   S03, S07 header
```

## Scores

```
Score badge (similarity)
  variants  none (0%), low (1-24), mid (25-49), high (50-74), max (75-100), banded on the whole number
            shown, so 0.4 reads "0%" and is uncoloured
  sizes     sm (table cell, 28px tall), lg (report header, text xl)
  states    pending "--", done, error "!", recalculating (number dimmed + spinner)
  tokens    bg score-{band}-bg, text score-{band}-text, radius sm, tabular numbers
  a11y      it is a link to the report: accessible name "Similarity 34%, open report";
            pending: "Similarity check in progress"
  used on   S03, S07

AI score badge
  variants  number, low (shown as "*" when 0 < score < 20), unavailable
  states    pending, done, unavailable, error
  tokens    under 50: bg ai-bg, text text, label "AI" in ai-solid; 50-79: score-mid; 80 and up: score-high
            (same bands as the report header readout); unavailable and under 20: bg surface-sunken,
            text text-muted
  a11y      name "AI writing estimate 42%, open AI report"; "*" reads as
            "AI writing estimate under 20%, not shown"; unavailable gives the reason
            ("needs at least 300 words of prose")
  used on   S03, S14
```

## Data

```
Papers list (S03, replaced the table)
  parts     search (every version's title and entry number, filters as you type, "N of M papers match",
            clear button, an empty state with "Clear the search") and sort (newest, highest AI writing,
            highest similarity, title A to Z) above the list; one card per paper: version stack, entry number centred beside the title, date and
            "Version n of m", status chip when there is one, both badges, row menu (move, delete),
            change since the version before, earlier versions as dated rows in a sunken strip
  states    loading (skeleton rows), empty (empty state), filled; a paper gaining a version re-enters
  motion    the page entrance cascades the first six cards (gaps shrinking), the stack and the badges
            land inside each with the settle rhythm
  used on   S03

Version stack
  parts     up to three offset sheets in CSS perspective, the top one ruled
  states    rest (flat offsets); hover or focus-within on the card: opens like a book, each sheet
            swinging on its left edge (settle in, exit out); reduced motion: the top sheet's edge
            turns accent instead
  used on   S03

Data table (kept for the /design sandbox; S03 now uses the papers list)
  columns   title, submitted, similarity, AI, status, row menu
  states    loading (skeleton rows), empty (empty state), filled, error (inline alert + retry)
  tokens    header text xs/500 text-muted, rows 48px, border-b border, hover surface
  a11y      real <table> with <th scope="col">; sortable headers are buttons with aria-sort;
            the title cell is the row's link; mobile: rows become stacked cards below md
  used on   S03, S12, S17

Upload dropzone (the home intake panel)
  variants  file
  states    idle, drag-over, uploading (progress), rejected (inline alert), disabled
  tokens    border 2px dashed border-input, radius lg, bg surface; drag-over: border focus, bg info-surface
  a11y      the whole zone is a <label> for a visible-on-focus file <input>; keyboard opens the picker
            with Enter or Space; accepted types and the 50 MB limit are in the text, not only in the
            accept attribute; rejection message names the file and the reason
  copy      "Drop a file here or choose one" / "Word, PDF, RTF, ODT or plain text, up to 50 MB"
  used on   S03 (compact)

Intake sheet (S04)
  parts     one pad sheet: "Upload a file" in its top bar, a textarea for pasting, drop a file anywhere
            on it; a status line under it; title (fills itself from the file name or the first line
            until edited) and paper fields; side panel: what happens next, what stays on this PC,
            what it takes
  states    empty, too short ("12 words · at least 20 needed"), ready, over 2 MB, dragging a file
            (dashed accent outline + "Let go to check this file"), file chosen (card with "Use text
            instead"), uploading (progress), error (inline alert), submitting
  a11y      the textarea is labelled "Your draft" and described by the status line (aria-live polite);
            the file picker is reachable by the Upload button for keyboard and touch
  used on   S04

Dropdown
  parts     trigger (field style, arrow turns while open), list on a pad sheet: labelled groups, items
            with a two-line title that wraps even without spaces, a mono detail line, an optional tag
            ("Suggested"), a check on the chosen item
  tokens    bg bg, border border, radius md, shadow pop, item hover surface, width = trigger (min 16rem)
  a11y      Radix Select: arrow keys, typeahead, Escape; label points at the trigger; with name it
            submits through a hidden native select
  used on   the paper picker (S03 intake panel, S04)

Menu
  parts     trigger button, items, separator, danger item
  tokens    bg bg, border border, radius md, shadow pop, item 36px, hover surface
  a11y      Radix DropdownMenu: arrow keys, typeahead, Escape returns focus to the trigger
  used on   S03 row menu, S15 download menu, header account menu

Modal
  variants  confirm, destructive confirm
  tokens    bg bg, radius lg, shadow pop, overlay text at 40% opacity, width 440px, padding 6
  a11y      Radix Dialog: focus trapped, Escape closes, focus returns to the trigger, title is the
            accessible name; destructive confirm puts focus on Cancel
  copy      delete: "Delete this draft?" / "Its reports go with it. This cannot be undone."
  used on   S17 delete (S03 delete has no confirm: its toast offers Undo instead)

Tooltip
  tokens    bg text, text bg, text xs, radius sm, padding 1 2, 400 ms delay
  a11y      Radix Tooltip: opens on hover and focus, never holds the only copy of information;
            icon buttons still need aria-label
  used on   badges, icon buttons, S11 filter help
```

## Report

```
Document viewer
  variants  similarity mode (S07), AI mode (S14)
  states    loading, filled, no matches, recalculating (highlights dimmed, panel shows status)
  tokens    canvas: the quad ground; paper: sheet, margin rule at md and up, max-w-paper, shadow card,
            padding 12 16; text text-doc in font-serif; bibliography part separated by a border-t border
  parts     its own scroll pane at lg and up with the Pad scrollbar: a draggable thumb and a tick per
            passage at its place in the text, coloured by source, click to jump (wheel, keys and touch
            stay native)
  a11y      <article> with the draft title as its heading; paragraphs are <p>; matches are <mark>
            (see Highlight span); j / k move through the to-resolve list and scroll the passage in
  used on   S07, S14

Highlight span
  variants  match-1..10 (cycles after 10), ai, ai-paraphrased, excluded, resolved (lighter, struck once),
            hidden-by-filter (not drawn)
  states    default, hover, selected, focus-visible
  tokens    bg match-{n}-bg, border-b 2px match-{n}-solid; selected: 2px outline match-{n}-solid;
            source number chip before the first span of each match: bg match-{n}-solid,
            text on-accent, text xs/600, radius sm; ai: bg ai-bg, border-b ai-solid;
            excluded: no fill, dashed border-b border-input, text text-muted
  a11y      <mark> containing a button-like link to the match: name "Match 3 of 12, source 2,
            27 words"; selected match gets aria-current="true"; colour + number, never colour alone
  used on   S07, S10, S14

Layer toggles
  parts     two pressed buttons, Similarity and AI writing, each on or off (AI disabled when there is no
            usable estimate, with the reason in its title); kept in the URL (?layers=)
  used on   S07

To-resolve list
  parts     progress ("N of M resolved", bar), items in reading order: colour square, snippet in serif,
            meta line; open items show their actions (match: Quote and cite, Rewrite, Exclude, Compare;
            AI: Rewrite, Keep), resolved items show their label and Undo
  states    open (snippet underlined in margin red), resolved (strike drawn through, text-muted),
            excluded (dotted underline), active (border accent, bg surface)
  a11y      ordered list "Flagged passages"; the active item has aria-current; keys j k c r e p z
  used on   S07

Side panel with tabs
  tabs      To resolve (with the open count), Sources, Filters
  states    open; below lg the panel sits under the sheet
  tokens    width 400px, bg bg, border-l border; tab text sm/600, selected border-b 2px accent
  a11y      Radix Tabs: arrow keys between tabs, the panel is labelled by its tab; the tab is in the
            URL (?panel=) so it survives reloads and back
  used on   S07 (S08, S09, S11, S12, S13)

Source card
  variants  internet, publication, library
  states    default, hover, selected, excluded, focus-visible
  parts     rank chip (match-{n}-solid), percent (text lg, tabular), type icon + label, title,
            host or publisher, matched words, Exclude / Restore button
  tokens    bg bg, border border, radius md, padding 3 4; selected: border match-{n}-solid;
            excluded: text text-muted, no chip colour
  a11y      the card is a list item; title is a button that selects the source and its first match;
            Exclude is a separate button with name "Exclude source 2"
  used on   S08, S12

Match group card
  groups    no-quote-no-citation, cited-not-quoted, quoted-not-cited, quoted-and-cited
  copy      "No quote, no citation" / "Cited but not quoted" / "Quoted but not cited" / "Quoted and cited"
  states    zero matches (text-muted, not clickable), n matches, selected
  tokens    bg bg, border border, radius md; count text lg tabular; selected border accent
  a11y      a button with aria-pressed that filters highlights to that group; name includes the count
  used on   S09

Split comparison pane
  parts     left: the draft passage; right: the source passage; source title + link; prev/next;
            Exclude match
  states    filled, source unavailable (cached text only, link may be dead), loading
  tokens    two columns at md and up, stacked below; both in font-serif text-base;
            matched words in match-{n}-bg
  a11y      region labelled "Match 3 compared with source 2"; external link has rel="noopener" and says
            it opens a new tab
  used on   S10

Filter controls
  parts     switches: leave out quoted text, leave out the reference list, leave out my earlier drafts;
            source type checkboxes; small sources threshold: number + unit (words | %); Apply, Reset
  states    default, dirty (Apply enabled), applying (button loading), invalid number
  tokens    rows 48px, border-b border; Switch: track border-input off, accent on, thumb bg
  a11y      Radix Switch with visible label; the threshold field explains itself in a hint
            ("Sources matching fewer words than this are left out"); after Apply, focus stays and a
            polite live region says "Recalculating"
  used on   S11

Flag card
  variants  hidden-text, swapped-characters
  parts     icon, type label, count, preview snippet with the characters marked, "Show in draft"
  tokens    bg warning-surface, text text, title in warning, radius md
  copy      "Hidden text" / "Text that is white, tiny or hidden in the file. It still counts."
            "Swapped characters" / "Letters from another alphabet that look like Latin ones."
  a11y      "Show in draft" moves focus to the flagged span in the viewer
  used on   S13
```

## Pages without a component of their own

Checking sequence: a miniature pad page whose lines are written in as steps finish, beside the three
steps (done, running with a breathing dot, next, failed, not run); used on S03 "Being checked now" and
on the report while it waits.

S05 (confirm), S06 (receipt) and S01 (sign in) are not built: personal and local, nothing to submit or sign in to. S15 is the Menu.

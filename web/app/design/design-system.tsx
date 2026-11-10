"use client";
// The design system check: every primitive, in isolation, with sample data. Not a product screen.
import { useState, type ReactNode } from "react";
import { FileText, MoreHorizontal, Trash2 } from "lucide-react";
import { DraftsTable } from "@/components/drafts-table";
import { Dropzone } from "@/components/dropzone";
import { Menu, Modal, PanelTabs, Switch, Tip, useToast } from "@/components/overlays";
import { DocumentViewer, FlagCard, MatchGroupCard, SourceCard, SplitCompare, type ViewerSpan } from "@/components/report";
import { AiBadge, ScoreBadge } from "@/components/score";
import { MATCH } from "@/lib/report.ts";
import { QueueButton, type QueueItem } from "@/components/queue-button";
import { UpdateNotice } from "@/components/update-notice";

// Sample queue for the sandbox only (synthetic titles); the real one comes from the job queue.
const DEMO_QUEUE: QueueItem[] = [
  { id: 15, title: "Coral reef essay, draft 3", step: "Searching the web for matching passages", waiting: false, steps: [
    { label: "Reading the file", state: "done" }, { label: "Searching the web for matching passages", state: "active" }, { label: "Estimating AI writing", state: "done" }] },
  { id: 16, title: "Wetlands_Field_Report_Final", step: "Reading the file", waiting: false, steps: [
    { label: "Reading the file", state: "active" }, { label: "Searching the web for matching passages", state: "pending" }, { label: "Estimating AI writing", state: "pending" }] },
];
// A long queue (a dozen uploads at once): the preview stops at four, the dialog scrolls inside itself.
const LONG_QUEUE: QueueItem[] = Array.from({ length: 12 }, (_, i) => ({
  ...DEMO_QUEUE[i % 2], id: 20 + i, title: `Chapter ${i + 1}: ${i % 2 ? "Methods_and_Field_Notes" : "Literature review, second pass"}`,
}));
import { AppHeader, Button, Checkbox, EmptyState, InlineAlert, ProgressBar, Skeleton, Spinner, StatusPill, TextArea, TextField } from "@/components/ui";

const DRAFT = `Coral reefs cover less than one percent of the ocean floor, yet they support roughly a quarter of all known marine species.
When water temperatures stay too high for several weeks, corals expel the algae that live in their tissue and turn white, a process known as bleaching.
Recovery is possible if conditions return to normal quickly, but repeated heat waves leave reefs little time to rebuild.
Local action still matters: reducing runoff and overfishing gives stressed reefs a better chance of surviving the next event (Hughes, 2018).
References
Hughes, T. (2018). Spatial and temporal patterns of mass bleaching of corals. Science, 359, 80-83.`;

const at = (phrase: string) => {
  const s = DRAFT.indexOf(phrase);
  return { start: s, end: s + phrase.length };
};

const SPANS: ViewerSpan[] = [
  { id: "m1", rank: 1, label: "Match 1 of 4, source 1, 18 words", ...at("they support roughly a quarter of all known marine species") },
  { id: "m2", rank: 2, label: "Match 2 of 4, source 2, 22 words", ...at("corals expel the algae that live in their tissue and turn white, a process known as bleaching") },
  { id: "m3", rank: 1, label: "Match 3 of 4, source 1, 12 words", ...at("repeated heat waves leave reefs little time to rebuild") },
  { id: "m4", rank: 3, label: "Match 4 of 4, source 3, 10 words", ...at("Spatial and temporal patterns of mass bleaching of corals") },
];

const AI_SPANS: ViewerSpan[] = [
  { id: "a1", rank: 1, kind: "ai", label: "Likely AI-written", ...at("Recovery is possible if conditions return to normal quickly, but repeated heat waves leave reefs little time to rebuild.") },
  { id: "a2", rank: 1, kind: "ai-paraphrased", label: "Likely AI-written, then paraphrased", ...at("reducing runoff and overfishing gives stressed reefs a better chance") },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border py-8">
      <h2 id={id} className="mb-4 text-lg">{title}</h2>
      {children}
    </section>
  );
}

// Each bar slides with one of the three timing tokens, so the difference between them can be felt.
function MotionDemo() {
  const [on, setOn] = useState(false);
  return (
    <div className="max-w-xl">
      <Button variant="secondary" size="sm" onClick={() => setOn((v) => !v)}>Move</Button>
      <div className="mt-3 space-y-2">
        {(["fast", "base", "slow"] as const).map((k) => (
          <div key={k} className="flex items-center gap-3 text-xs">
            <span className="w-24 font-mono text-muted">--motion-{k}</span>
            <div className="h-2 flex-1 rounded-sm bg-surface-sunken">
              <div className="h-2 w-8 rounded-sm bg-accent motion-safe:transition-transform"
                style={{ transform: on ? "translateX(calc(100% * 6))" : "none", transitionDuration: `var(--motion-${k})`, transitionTimingFunction: "var(--motion-ease)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Demo() {
  const toast = useToast();
  const [selected, setSelected] = useState("m1");
  const [excluded, setExcluded] = useState<number[]>([]);
  const [panel, setPanel] = useState("sources");
  const [quotes, setQuotes] = useState(true);
  const [refs, setRefs] = useState(false);
  const [progress, setProgress] = useState<number | undefined>();
  const [group, setGroup] = useState<string | null>(null);

  const toggle = (rank: number) => {
    setExcluded((e) => (e.includes(rank) ? e.filter((r) => r !== rank) : [...e, rank]));
    toast(excluded.includes(rank) ? `Source ${rank} restored` : `Source ${rank} excluded. Recalculating.`);
  };
  const fakeUpload = () => {
    let p = 0;
    const t = setInterval(() => { p += 20; setProgress(p); if (p >= 100) { clearInterval(t); setTimeout(() => setProgress(undefined), 600); } }, 250);
  };
  const viewerSpans = SPANS.map((s) => (excluded.includes(s.rank) ? { ...s, kind: "excluded" as const } : s));

  return (
    <>
      <AppHeader current="design" />
      <main id="main" className="mx-auto w-full max-w-content-max px-4 pb-16 md:px-8">
        <h1 className="pt-8 text-xl">Design system</h1>
        <p className="mt-1 text-sm text-muted">Every primitive from components.md with sample data, in the computation pad&apos;s palette and type.</p>

        <Section id="s-type" title="Type">
          <div className="space-y-2">
            <p className="text-display">Display 40</p>
            <p className="text-xl">Heading 28</p>
            <p className="text-lg">Title 20</p>
            <p className="font-serif text-doc">Document 18, Literata, for the draft itself.</p>
            <p className="text-base">Body 16, Public Sans</p>
            <p className="text-sm">Small 14</p>
            <p className="text-xs text-muted">Caption 12, muted</p>
            <p className="font-mono text-sm">No. 003 · 42% · 1,204 words · Red Hat Mono for numbers</p>
          </div>
        </Section>

        <Section id="s-pad" title="The pad: ground, sheet and line forms">
          <div className="quad rounded-md border border-border p-4 md:p-8">
            <div className="sheet md:margin-rule mx-auto max-w-paper rounded-sm px-6 py-8 font-serif text-doc md:px-16">
              <p className="mb-4">
                <span className="state-open">An open match</span> is underlined solid in the margin red until you decide something about it.
              </p>
              <p className="mb-4">
                <span className="state-resolved">A resolved match</span> is struck once and kept in place, never removed.
              </p>
              <p>
                <span className="state-excluded">An excluded source</span> is dotted: left out of the score, still readable.
              </p>
            </div>
          </div>
        </Section>

        <Section id="s-motion" title="Motion tokens">
          <MotionDemo />
        </Section>

        <Section id="s-buttons" title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Run check</Button>
            <Button variant="secondary">Paste text</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Delete draft</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Tip label="More actions">
              <Button variant="ghost" iconOnly aria-label="More actions"><MoreHorizontal aria-hidden className="size-5" /></Button>
            </Tip>
          </div>
        </Section>

        <Section id="s-forms" title="Fields">
          <div className="grid max-w-xl gap-4">
            <TextField id="f-title" label="Title" placeholder="Coral reef essay, draft 2" />
            <TextField id="f-small" label="Leave out small sources" type="number" unit="words" defaultValue={8} hint="Sources matching fewer words than this are left out." />
            <TextField id="f-bad" label="Leave out small sources" type="number" unit="%" defaultValue={120} error="Enter a number from 0 to 100." />
            <TextArea id="f-paste" label="Paste your text" hint="At least 20 words." rows={4} />
            <Checkbox id="f-check" label="Also add this draft to my library" />
          </div>
        </Section>

        <Section id="s-feedback" title="Feedback">
          <div className="grid max-w-xl gap-3">
            <InlineAlert variant="info" title="Checks take about a minute">The score appears in your drafts list when it is ready.</InlineAlert>
            <InlineAlert variant="success" title="Draft submitted">Receipt 3F9A21C04B7E.</InlineAlert>
            <InlineAlert variant="warning" title="This score is an estimate">It comes from an open model. It can be wrong in both directions and is not proof of anything.</InlineAlert>
            <InlineAlert variant="danger" title="That file can't be checked">This PDF has no selectable text. Export it again with text, or paste the text instead.</InlineAlert>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="queued" /><StatusPill status="processing" /><StatusPill status="recalculating" />
              <StatusPill status="waiting" /><StatusPill status="error" /><StatusPill status="rejected" />
              <Spinner label="Loading" />
            </div>
            <ProgressBar value={60} label="Uploading" />
            <ProgressBar label="Checking for matches" />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => toast("Filters saved. Recalculating.")}>Show toast</Button>
              <Button variant="secondary" onClick={() => toast("Upload failed. Try again.", "error")}>Show error toast</Button>
              <Button variant="secondary" onClick={() => toast("Deleted “Coral reef essay, draft 2”", "success", {
                duration: 8000, undo: () => toast("Delete undone"), onClose: () => toast("Deleted for good (demo)"),
              })}>Show undo toast</Button>
            </div>
          </div>
        </Section>

        <Section id="s-scores" title="Score badges">
          <div className="flex flex-wrap items-center gap-3">
            {[0, 12, 34, 61, 88].map((s) => <ScoreBadge key={s} score={s} href="#" />)}
            <ScoreBadge state="pending" href="#" />
            <ScoreBadge score={34} state="recalculating" href="#" />
            <ScoreBadge state="error" href="#" />
            <ScoreBadge score={34} size="lg" href="#" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <AiBadge score={42} href="#" />
            <AiBadge score={12} href="#" />
            <AiBadge score={0} href="#" />
            <AiBadge state="pending" href="#" />
            <AiBadge state="unavailable" reason="needs at least 300 words of prose" href="#" />
          </div>
        </Section>

        <Section id="s-table" title="Drafts table, menu, modal">
          <DraftsTable rows={[
            { id: 1, title: "Coral reef essay, draft 2", submitted: "28 Oct 2026, 21:14", similarity: { score: 34, href: "#" }, ai: { score: 12, href: "#" },
              menu: <Menu trigger={<Button variant="ghost" size="sm" iconOnly aria-label="Actions for Coral reef essay, draft 2"><MoreHorizontal aria-hidden className="size-4" /></Button>}
                items={[{ label: "Open report", onSelect: () => {} }, { label: "Upload new version", onSelect: () => {} }, "separator", { label: "Delete", danger: true, onSelect: () => {} }]} /> },
            { id: 2, title: "Lab report: enzyme rates", submitted: "28 Oct 2026, 22:02", similarity: { state: "pending", href: "#" }, ai: { state: "pending", href: "#" }, status: "processing" },
            { id: 3, title: "Reading notes", submitted: "27 Oct 2026, 10:40", similarity: { state: "error", href: "#" }, ai: { state: "unavailable", reason: "needs at least 300 words of prose", href: "#" }, status: "error" },
          ]} />
          <div className="mt-4 max-w-md"><DraftsTable rows={[]} loading /></div>
          <div className="mt-4">
            <Modal destructive title="Delete this draft?" body="Its reports go with it. This cannot be undone." confirmLabel="Delete"
              onConfirm={() => toast("Draft deleted")}
              trigger={<Button variant="danger"><Trash2 aria-hidden className="size-4" /> Delete draft</Button>} />
          </div>
        </Section>

        <Section id="s-upload" title="Upload">
          <div className="max-w-xl"><Dropzone onFile={fakeUpload} progress={progress} /></div>
        </Section>

        <Section id="s-queue" title="Queue (header): hover for the preview, click for every step">
          <div className="flex flex-wrap items-center gap-6 rounded-md bg-shell px-4 py-3">
            <QueueButton state="working" items={DEMO_QUEUE} />
            <QueueButton state="working" items={LONG_QUEUE} />
            <QueueButton state="stalled" items={DEMO_QUEUE.slice(0, 1)} />
            <QueueButton state="idle" items={[]} />
            <UpdateNotice version="0.2.0" current="0.1.0" url="" autoUpdate={false} inWindow />
          </div>
        </Section>

        <Section id="s-empty" title="Empty and loading">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border">
              <EmptyState icon={<FileText className="size-8" />} title="No drafts yet" body="Drop a file or paste your text to run your first check." action={<Button>Check a draft</Button>} />
            </div>
            <div className="space-y-3 rounded-md border border-border p-6">
              <Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        </Section>

        <Section id="s-report" title="Report: viewer and side panel">
          <div className="overflow-hidden rounded-md border border-border lg:grid lg:grid-cols-[1fr_var(--layout-panel)]">
            <DocumentViewer title="Coral reef essay, draft 2" text={DRAFT} spans={viewerSpans} selectedId={selected} onSelect={setSelected}
              bibliographyStart={DRAFT.indexOf("References")} />
            <aside aria-label="Report details" className="border-border bg-bg max-lg:border-t lg:border-l">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-sm font-semibold">Similarity</span>
                <ScoreBadge score={excluded.includes(1) ? 19 : 34} size="lg" href="#" />
              </div>
              <PanelTabs value={panel} onValueChange={setPanel} tabs={[
                { value: "sources", label: "Sources", content: (
                  <ol className="space-y-2">
                    <SourceCard rank={1} percent={19} type="internet" title="Why coral reefs matter" host="oceanfacts.example.org" words={30}
                      selected={selected === "m1" || selected === "m3"} excluded={excluded.includes(1)} onSelect={() => setSelected("m1")} onToggleExclude={() => toggle(1)} />
                    <SourceCard rank={2} percent={11} type="publication" title="Thermal stress and symbiont loss in reef-building corals" host="OpenAlex" words={22}
                      selected={selected === "m2"} excluded={excluded.includes(2)} onSelect={() => setSelected("m2")} onToggleExclude={() => toggle(2)} />
                    <SourceCard rank={3} percent={4} type="library" title="Biology essay, spring term" host="biology-essay.docx" words={10}
                      selected={selected === "m4"} excluded={excluded.includes(3)} onSelect={() => setSelected("m4")} onToggleExclude={() => toggle(3)} />
                  </ol>
                ) },
                { value: "groups", label: "Groups", content: (
                  <div className="space-y-2">
                    {(["not_cited_or_quoted", "missing_quotation", "missing_citation", "cited_and_quoted"] as const).map((g, i) => (
                      <MatchGroupCard key={g} group={g} count={[2, 1, 0, 1][i]} percent={[23, 11, 0, 4][i]} selected={group === g} onToggle={() => setGroup(group === g ? null : g)} />
                    ))}
                  </div>
                ) },
                { value: "flags", label: "Flags", content: (
                  <div className="space-y-3">
                    <FlagCard type="replaced_characters" count={3} snippet="c[о]ral re[е]fs" />
                    <FlagCard type="hidden_text" count={1} snippet="white text, 14 words, paragraph 2" />
                  </div>
                ) },
                { value: "filters", label: "Filters", content: (
                  <div>
                    <Switch id="sw-quotes" label="Leave out quoted text" checked={quotes} onCheckedChange={setQuotes} />
                    <Switch id="sw-refs" label="Leave out the reference list" hint="Everything after the References heading." checked={refs} onCheckedChange={setRefs} />
                    <div className="mt-4 flex gap-2"><Button onClick={() => toast("Filters saved. Recalculating.")}>Apply</Button><Button variant="ghost">Reset</Button></div>
                  </div>
                ) },
              ]} />
            </aside>
          </div>
          <div className="mt-6">
            <SplitCompare rank={2} sourceTitle="Thermal stress and symbiont loss in reef-building corals"
              draft={["When water temperatures stay too high for several weeks, ", "corals expel the algae that live in their tissue and turn white, a process known as bleaching", "."]}
              source={["Under prolonged thermal stress, ", "corals expel the algae that live in their tissue and turn white, a process known as bleaching", ", which can be fatal."]} />
          </div>
        </Section>

        <Section id="s-ai" title="AI writing viewer">
          <DocumentViewer title="Coral reef essay, draft 2" text={DRAFT} spans={AI_SPANS} />
          <div className="mt-3 flex gap-4 text-sm">
            <span className="flex items-center gap-2"><span aria-hidden className="size-3 border-b-2 border-ai-solid bg-ai-bg" /> Likely AI-written</span>
            <span className="flex items-center gap-2"><span aria-hidden className="size-3 border-b-2 border-ai-paraphrased-solid bg-ai-paraphrased-bg" /> Likely AI-written, then paraphrased</span>
          </div>
        </Section>

        <Section id="s-palette" title="Source colours">
          <div className="flex flex-wrap gap-2">
            {MATCH.map((c, i) => (
              <span key={i} className="font-serif text-base">
                <mark className={`text-inherit border-b-2 px-1 ${c.tint} ${c.line}`}>source {i + 1}</mark>
              </span>
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}

export function DesignSystem() {
  return <Demo />;
}

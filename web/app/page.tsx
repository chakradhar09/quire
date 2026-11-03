import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { matchVars } from "@/components/evidence";
import { StrikeDemo } from "@/components/strike-demo";
import { AppHeader, buttonClass, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Quire" };

const tint = (rank: number) => ({ "--tint": matchVars(rank).tint, "--line": matchVars(rank).line }) as CSSProperties;
const MARK = "ev bg-transparent text-inherit";
const AI = { "--tint": "var(--ai-bg)", "--line": "var(--ai-solid)" } as CSSProperties;

// The page is still except for one moment: the sample sheet in the hero resolves its matches one by one,
// starting a beat after the page appears (StrikeDemo).
const DEMO_START_MS = 900;

function Specimen({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 border-t border-border py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
      <div>
        <h3 className="text-xl text-balance">{title}</h3>
        <p className="mt-3 max-w-md text-muted">{body}</p>
      </div>
      <div className="rounded-lg border border-border bg-bg">{children}</div>
    </div>
  );
}

const STEPS = [
  { title: "Read", body: "The worker pulls the text out of your Word, PDF, RTF or ODT file, keeping equations, captions and the reference list in their place." },
  { title: "Search", body: "Phrases from the draft go to a web search. Pages that share eight or more words in a row become sources, ranked by how much they cover." },
  { title: "Estimate", body: "A classifier on this PC scores each passage of prose for AI-like writing. Under 300 words, or under 20%, it says so instead of guessing." },
];

export default function Home() {
  return (
    <>
      <AppHeader current="home" autohide />
      <main id="main">
        <section id="hero" className="quad overflow-x-clip border-b border-border">
          <div className="mx-auto grid w-full max-w-content-max items-center gap-12 px-4 pt-14 pb-20 md:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-20 lg:pb-28">
            <div>
              <h1 className="text-hero text-balance">
                Read your draft the way a checker will.
              </h1>
              <p className="mt-6 max-w-lg text-lg text-muted">
                Quire finds the sentences in your paper that match web pages and publications, ranks the sources, and estimates how much reads as AI-written. Then it hands you a list to work through, one passage at a time. Everything except the web searches happens on this PC.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/submit" className={buttonClass("primary", "lg")}>Check a draft</Link>
                <Link href="/drafts" className={buttonClass("secondary", "lg")}>Open your papers</Link>
              </div>
            </div>
            <StrikeDemo startAfter={DEMO_START_MS} />
          </div>
        </section>

        <section aria-labelledby="shows-heading" className="mx-auto w-full max-w-content-max px-4 py-20 md:px-8">
          <h2 id="shows-heading" className="max-w-2xl text-section text-balance">
            Every number comes with the passages behind it.
          </h2>
          <div className="mt-10">
            <Specimen title="Matching sources, side by side"
              body="Each source gets a colour and a rank. Open a match and your sentence sits next to the source's, so you can quote it, cite it or rewrite it.">
              <div className="grid divide-border sm:grid-cols-2 sm:divide-x">
                <div className="p-5">
                  <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Your draft</p>
                  <p className="font-serif leading-7">Bleaching happens when <mark className={MARK} style={tint(2)}>corals expel the algae that live in their tissue and turn white</mark> after weeks of heat.</p>
                </div>
                <div className="border-t border-border p-5 sm:border-t-0">
                  <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Source 2</p>
                  <p className="font-serif leading-7">Under thermal stress, <mark className={MARK} style={tint(2)}>corals expel the algae that live in their tissue and turn white</mark>, losing their main food supply.</p>
                </div>
              </div>
            </Specimen>
            <Specimen title="An AI writing estimate, with its limits"
              body="Passages that read as machine-written are marked. The report always says what the model was calibrated on and how often it is wrong, because it is an estimate, not proof.">
              <div className="p-5">
                <p className="font-serif leading-7">
                  Reefs matter for coastal towns. <mark className={MARK} style={AI}>Furthermore, it is important to note that coral ecosystems play a crucial role in supporting biodiversity and sustaining livelihoods.</mark> Fishers in the bay have seen fewer parrotfish each year.
                </p>
                <p className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-muted">
                  <span aria-hidden className="inline-block h-3 w-5 border-b-2 border-ai-solid bg-ai-bg" />
                  Reads as AI-written. Human writing can be flagged and AI writing missed.
                </p>
              </div>
            </Specimen>
            <Specimen title="What hides in the file"
              body="Text set in white or at a tiny size, and letters swapped for look-alikes from other alphabets, are found and shown, because a checker would find them too.">
              <div className="space-y-3 p-5 font-serif leading-7">
                <p>
                  <span className="rounded-xs bg-warning-surface px-0.5 outline outline-1 outline-dashed outline-warning">C<span className="font-sans font-bold text-warning">о</span>ral</span> reefs cover less than one percent of the ocean floor.
                  <span className="ml-2 font-sans text-xs text-muted">The second letter is Cyrillic.</span>
                </p>
                <p className="text-muted">
                  Hidden in white: <span className="rounded-xs px-1 text-text outline outline-1 outline-dashed outline-border-input">reef ecology coral bleaching marine biology</span>
                </p>
              </div>
            </Specimen>
          </div>
        </section>

        <section aria-labelledby="runs-heading" className="border-y border-border bg-bg">
          <div className="mx-auto w-full max-w-content-max px-4 py-20 md:px-8">
            <h2 id="runs-heading" className="text-section">How a check runs</h2>
            <ol className="relative mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              <span aria-hidden className="absolute top-2 right-0 left-0 h-px bg-border max-md:hidden" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative">
                  <span aria-hidden className={cx("relative block size-4 rounded-pill border-2 border-accent bg-bg", i === 1 && "bg-accent")} />
                  <div>
                    <h3 className="mt-5 text-lg">{s.title}</h3>
                    <p className="mt-2 text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="pc-heading" className="mx-auto w-full max-w-content-max px-4 py-20 md:px-8">
          <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
            <h2 id="pc-heading" className="text-section text-balance">Your drafts stay on this PC.</h2>
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {[
                ["No account", "There is nothing to sign in to and no one else's server holding your work."],
                ["Local files", "Uploads, extracted text and reports live in the data folder next to the app."],
                ["Local model", "The AI writing estimate runs in the worker on this machine."],
                ["Searches only", "The only thing that leaves is the short phrases sent to find matching pages."],
              ].map(([t, d]) => (
                <div key={t} className="border-t border-border pt-4">
                  <dt className="font-semibold">{t}</dt>
                  <dd className="mt-1 text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

      </main>
      <footer className="mx-auto w-full max-w-content-max px-4 py-8 text-sm text-muted md:px-8">
        Quire is a personal tool, not affiliated with any commercial checker.
      </footer>
    </>
  );
}

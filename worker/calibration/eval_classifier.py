"""Test a detector on everything kept out of training, at the threshold calibrate_ai would set.

    python -m calibration.eval_classifier [--detector classifier|binoculars] [--model <folder>]      from worker/

The threshold comes from the same 300 PERSUADE essays and data/calibration/ai/ essays as T13 (1% of human
windows), so the numbers line up with Binoculars'. Then, at that threshold, it reports the share of windows
flagged on each held-out set: models never trained on, Ghostbuster's and IDMGSP's test splits, RAID's test
titles, the legal and government documents' and STEM texts' test splits (which also join the human windows the mixed threshold
is set on), and TextSight's 2026 set (human Wikipedia, non-native academic papers, old literature; current
models). Last, it scores real pages cached in the database the way S14 would, among them a 2017 Yale Law Journal
article and a BLS job page that v3 flagged and five LibreTexts pages, and AI-written drafts such as document 3
(a model-written physics assignment v3 scored 0%); those are only checks, never part of any threshold or training.
Writes data/calibration/report-{detector}.md.
"""
import argparse
import csv
import json
import random
import time

import calibrate_ai
from calibration import data_dir, persuade
from ai import analyse, prose_sentences
from ai import windows as ai_windows
from calibration.classifier_data import (GHOSTBUSTER_HUMAN, cut, idmgsp, in_test, legal, raid_abstracts, root, stem,
                                          unarxive)
from calibration.train_classifier import auroc
from text import bibliography_start, normalize

LEGAL_TEST_DOCS, LEGAL_TEST_WORDS = 25, 1200  # per source, from the opening, so long casebooks don't swamp the rest
# Human pages cached in the sources table (fetched for similarity checks), by id. Company blogs from 2024 on are left
# out: they may really be AI-written.
CHECK_PAGES = {21: "Yale Law Journal, Machine Testimony (2017)", 5: "BLS Occupational Outlook, forensic technicians",
               8: "forensicsciencesimplified.org", 19: "Wikipedia, Confirmation bias", 6: "crime-scene-investigator.net",
               1: "Wikipedia, Chain of custody", 13: "NYBooks (2024)", 22: "NCBI book", 20: "kesuresh blog (2015)",
               27: "LibreTexts, Line spectra and the Bohr model", 34: "LibreTexts, Light waves",
               36: "LibreTexts, De Broglie's matter waves (OpenStax)", 37: "LibreTexts, Heisenberg uncertainty principle",
               45: "LibreTexts, Compton scattering"}
# Drafts in the documents table known to be AI-written, by id: checks only, never training data.
CHECK_AI_DRAFTS = {3: "Document 3, a physics assignment (Sonnet 5.5)", 4: "Document 4, Research_Paper_v3_IEEE (Claude)",
                   5: "Document 5, Research_Paper_Draft_v2 (Claude)"}
PAPERS_TEST_DOCS = 200
STEM_TEST_DOCS = 200


def held_out_sets(rng):
    """{set name: [(label, text)]}, 1 meaning AI."""
    import pyarrow.parquet as pq
    sets = {}
    gen = root() / "generated/test"
    for kind in ("essays", "abstracts", "legal", "stem", "papers"):
        for p in sorted((gen / kind).glob("*.txt")):
            model = next((m for m in ("nemotron-3-ultra", "nemotron-3-5-lightning", "step-5", "claude-opus", "claude-sonnet") if m in p.name), "other")
            sets.setdefault(f"held-out {kind}: {model}", []).append((1, p.read_text(encoding="utf-8")))
    raid = [a for a in raid_abstracts() if in_test(a[0])]
    sets["RAID test abstracts: human"] = [(0, t) for _, m, t in raid if m == "human"]
    sets["RAID test abstracts: AI"] = rng.sample([(1, t) for _, m, t in raid if m != "human"], 300)
    gb = pq.read_table(root() / "raw/ghostbuster/test.parquet").to_pylist()
    sets["Ghostbuster test: human"] = [(0, r["text"]) for r in gb if r["label"] == GHOSTBUSTER_HUMAN]
    sets["Ghostbuster test: AI"] = rng.sample([(1, r["text"]) for r in gb if r["label"] != GHOSTBUSTER_HUMAN], 300)
    papers = list(idmgsp("test"))
    sets["IDMGSP test: real papers"] = rng.sample([(0, t) for s, t in papers if s == "real"], 300)
    sets["IDMGSP test: ChatGPT/Galactica"] = rng.sample([(1, t) for s, t in papers if s in ("chatgpt", "galactica")], 300)
    by_source = {}
    for source, key, _, text in legal():
        if in_test(key):
            by_source.setdefault(source.split(".")[-1], []).append(" ".join(text.split(" ")[:LEGAL_TEST_WORDS]))
    for source, texts in sorted(by_source.items()):
        sets[f"Legal/gov test: {source}"] = [(0, t) for t in rng.sample(texts, min(len(texts), LEGAL_TEST_DOCS))]
    by_source = {}
    for source, key, text in stem():
        if in_test(key):
            by_source.setdefault(source, []).append(text)
    for source, texts in sorted(by_source.items()):
        sets[f"STEM test: {source}"] = [(0, t) for t in rng.sample(texts, min(len(texts), STEM_TEST_DOCS))]
    papers = [t for k, t in unarxive() if in_test(k)]
    sets["Papers test: unarXive CS (pre-2022)"] = [(0, t) for t in rng.sample(papers, min(len(papers), PAPERS_TEST_DOCS))]
    for f in sorted((root() / "raw/textsight").glob("*.jsonl")):
        rows = [json.loads(line) for line in f.open(encoding="utf-8")]
        sets[f"TextSight: {f.stem}"] = [(int(r["label"] == "ai") if isinstance(r["label"], str) else int(r["label"]), r["text"]) for r in rows]
    return sets


def cached_pages(table="sources", checks=CHECK_PAGES):
    """(label, text) of the checks, read-only from the database."""
    import sqlite3
    from calibration import migrate
    db = sqlite3.connect(f"file:{migrate.default_path()}?mode=ro", uri=True)
    try:
        rows = dict(db.execute(f"select id, text from {table} where id in ({','.join('?' * len(checks))})",
                               list(checks)).fetchall())
    finally:
        db.close()
    return [(label, rows[i]) for i, label in checks.items() if rows.get(i)]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--detector", choices=["classifier", "binoculars"], default="classifier")
    parser.add_argument("--model", help="classifier folder (default data/calibration/classifier/model)")
    args = parser.parse_args()
    import main as worker
    worker.load_env(worker.HERE / ".env")
    if args.detector == "classifier":
        from classifier import Classifier
        scorer, name = Classifier(args.model, threshold=1.0), f"classifier ({args.model or 'model'})"
    else:
        from binoculars import Binoculars
        scorer = Binoculars(threshold=1.0)
        name = f"Binoculars ({scorer.observer_name} / {scorer.performer_name})"

    start = time.perf_counter()
    human = {e["id"]: normalize(e["text"]) for e in persuade.sample(n=300)}
    ai = calibrate_ai.read_folder(data_dir() / "ai")
    r = calibrate_ai.calibrate(human, ai, scorer, log=print)
    t = r["threshold"]
    h_scores, a_scores = r["human_scores"], r["ai_scores"]
    lines = [f"Calibration set: threshold {t:.4f}, human windows flagged {100 * r['false_positive_rate']:.1f}%, "
             f"AI windows caught {r['ai_windows_caught']}/{r['ai_windows']}, AI essays flagged "
             f"{r['ai_essays_flagged']}/{r['ai_essays_scored']}, window AUROC "
             f"{auroc([-s for s in h_scores + a_scores], [0] * len(h_scores) + [1] * len(a_scores)):.3f}", "",
             "", "| Held-out set | Label | Windows | Flagged (essay threshold) | Flagged (mixed threshold) |",
             "|---|---|---|---|---|"]
    results = {}
    for set_name, docs in held_out_sets(random.Random(7)).items():
        texts, labels = [], []
        for label, text in docs:
            for w in cut(text):
                texts.append(w)
                labels.append(label)
        if texts:  # in CHUNKs: Binoculars' swap mode keeps ~70 MB a window in RAM per call
            results[set_name] = ([s for i in range(0, len(texts), calibrate_ai.CHUNK)
                                  for s in scorer(texts[i:i + calibrate_ai.CHUNK])], labels)
            print(f"  {set_name}: {len(texts)} windows", flush=True)
    # A second threshold, set on student essays, academic and legal/government writing together (not TextSight,
    # which stays unseen).
    mixed_human = h_scores + [s for n, (ss, ls) in results.items() if not ls[0] and not n.startswith("TextSight") for s in ss]  # noqa: E501
    m, m_rate = calibrate_ai.threshold_for(mixed_human, 0.01)
    a_cut = calibrate_ai._windows(ai)
    a_caught = [calibrate_ai._essay_score(c, scorer(ws), q, m) for ws, c, q in a_cut.values()]
    pooled = {}
    for set_name, (scores, labels) in results.items():
        group = set_name.split(":")[0]
        pooled.setdefault(group, ([], []))
        pooled[group][0].extend(-s for s in scores)
        pooled[group][1].extend(labels)
        pct = lambda th: f"{100 * sum(s < th for s in scores) / len(scores):.1f}%"  # noqa: E731
        lines.append(f"| {set_name} | {'AI' if labels[0] else 'human'} | {len(scores)} | {pct(t)} | {pct(m)} |")
        print(lines[-1], flush=True)
    lines += ["", f"Mixed threshold {m:.4f} ({100 * m_rate:.1f}% of {len(mixed_human)} human windows: PERSUADE, RAID, "
              f"Ghostbuster, IDMGSP, legal/gov). At it, calibration AI windows caught {sum(s < m for s in a_scores)}/{len(a_scores)}, "
              f"AI essays flagged {sum(v is not None and v >= calibrate_ai.SHOWN for v in a_caught)}/"
              f"{sum(v is not None for v in a_caught)}, PERSUADE windows flagged {100 * sum(s < m for s in h_scores) / len(h_scores):.1f}%.",
              "", "Window AUROC per source (human vs AI pooled): " + ", ".join(
                  f"{g} {auroc(s, l):.3f}" for g, (s, l) in pooled.items() if 0 < sum(l) < len(l))]
    lines += ["", "Cached human pages, scored as S14 would at the mixed threshold (first 20,000 characters):", "",
              "| Page | S14 score | Windows flagged |", "|---|---|---|"]
    for label, text in cached_pages():
        page = analyse(text[:20000], None, scorer, m)
        lines.append(f"| {label} | {page.score if page.score is not None else page.reason}% | {len(page.segments)} |")
    lines += ["", "AI-written drafts in the database, scored as S14 would at the mixed threshold:", ""]
    for label, text in cached_pages("documents", CHECK_AI_DRAFTS):
        bib = bibliography_start(text)  # as the worker stores it, so a reference list is not scored as prose
        windows = [" ".join(text[a:b] for a, b, _ in g) for g in ai_windows(prose_sentences(text, bib))]
        scores = scorer(windows)
        page = analyse(text, bib, scorer, m)
        lines.append(f"- {label}: S14 score {page.score}%, {sum(x < m for x in scores)} of {len(scores)} windows "
                     f"flagged; window scores {' '.join(f'{x:.3f}' for x in scores)}")
    text = f"# {name}\n\nRun in {time.perf_counter() - start:.0f} s.\n\n" + "\n".join(lines) + "\n"
    (data_dir() / f"report-{args.detector}.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

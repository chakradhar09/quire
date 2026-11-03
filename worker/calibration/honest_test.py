"""An honest test of the AI-writing classifier on the kinds of paper Quire is used for: law papers, patent
specifications and CS/engineering research papers, written by models and from prompts it never trained on.

    python -m calibration.honest_test --generate      from worker/; writes data/calibration/classifier/generated/honest/
    python -m calibration.honest_test --score [--model <folder> --threshold <t>]   writes data/calibration/report-honest[-<folder>].md

Why another test: the held-out papers in eval_classifier were written by the same Claude sessions as the training
papers, so their 94-99% is optimistic. Here every topic is invented for this file (none from a draft, none from a
training title), and the models are ones the classifier never saw: Nemotron-3.5-Super-VL and the three
eval_classifier already holds out (see MODELS for why no family absent from training is among them). Each paper is asked for in one of three styles,
one of them telling the model to sound human. Nothing here is ever read by classifier_data, which reads only
generated/train.

The human side is pre-2019 patent descriptions from BigPatent's test split (CC BY 4.0), fetched through Hugging
Face's dataset viewer and cached in raw/bigpatent/test.jsonl; four Pile of Law sources training never read
(UNSEEN_LEGAL, downloaded by hand into raw/pileoflaw/: NLRB, SEC, EOIR and FTC decisions and opinions); and any
extra human sets dropped into raw/honest/ as JSONL lines {"text": ...} (one file per set). Scoring uses the deployed threshold (AI_CLASSIFIER_THRESHOLD) and
reports both the share of windows flagged and each document's score as S14 shows it (under 20% shows as *).
"""
import argparse
import json
import os
import random
import re
from concurrent.futures import ThreadPoolExecutor

import httpx
from pathlib import Path

from calibration.classifier_data import plain, root
from calibration.generate_nvidia import answering, one
from calibration.generate_ai import slug

# Five slots in the rotation. Kimi K2.6, Nemotron-3-Super, Phi, Llama and the other families training never saw
# return 404 for this API key (2026-11-02), so the first two slots hold Nemotron-3.5-Super-VL, which training never
# used, and Lightning again: every model here is unseen, but only StepFun is outside NVIDIA's family.
MODELS = ["nvidia/nemotron-3.5-super-vl-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b",
          "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3.5-lightning-30b-a3b", "stepfun-ai/step-5-preview"]
WORKERS = 8
SHOWN = 20

GENRES = {
    "patent": ("the specification of a patent application for {t}: title, field of the invention, background, summary, "
               "brief description of the drawings, detailed description of the embodiments, and claims", [
        "a self-cleaning rain gutter guard with a brush turned by the water flow",
        "a wearable sensor patch that detects early pressure ulcers in bedridden patients",
        "a method for reducing cold-start latency of serverless functions by predicting and pre-warming containers",
        "a bicycle frame joint that folds without tools",
        "a battery cooling plate with channels of phase-change material",
        "a handheld near-infrared device for detecting counterfeit medicines",
        "a beehive monitor that predicts swarming from the sound of the colony",
        "a method for compressing sensor time series on microcontrollers with adaptive delta encoding",
        "a child-resistant closure for detergent pods that opens with a two-stage squeeze",
        "a crop-spraying drone nozzle that changes droplet size with wind speed",
        "a kitchen exhaust hood that captures grease on an electrostatic mesh",
        "a method for authenticating firmware updates on industrial controllers with threshold signatures"]),
    "law": ("a law school research paper of about 2,000 words on {t}, with an introduction, an analysis of the law and "
            "the leading cases and statutes, and a conclusion, citing authorities the way law papers do", [
        "whether inventions made by AI systems can be patented under current inventorship rules",
        "the admissibility of smartphone location data as evidence in criminal trials",
        "liability for accidents caused by self-driving cars under product liability law",
        "the enforceability of click-wrap agreements in consumer contracts",
        "the right to be forgotten and its conflict with freedom of expression",
        "trade secret protection, employee mobility and non-compete clauses",
        "copyright in the data used to train machine learning models and the fair use defence",
        "smart contracts and the doctrine of contract formation",
        "data localisation laws and cross-border transfers of personal data",
        "the doctrine of equivalents in patent infringement after Festo",
        "environmental impact assessment for large infrastructure projects",
        "police use of facial recognition and the right to privacy"]),
    "cs": ("an IEEE-format research paper of about 2,000 words on {t}: abstract, introduction, related work, proposed "
           "method, experimental setup, results and discussion, and conclusion", [
        "detecting plagiarism in students' source code with abstract syntax tree fingerprints",
        "a low-cost air-quality monitoring network with calibrated particulate sensors",
        "recognising handwritten mathematical expressions with encoder-decoder models",
        "energy-efficient clustering protocols for wireless sensor networks",
        "crowd counting in surveillance video by density-map regression",
        "blockchain-based land registry records for developing countries",
        "smartphone object detection to help visually impaired people navigate indoors",
        "battery-free sensing with backscatter communication",
        "generating university timetables with genetic algorithms",
        "lightweight intrusion detection for home routers",
        "choosing solar panel tilt angles from weather data with machine learning",
        "speaker verification that resists replay attacks"]),
}
STYLES = {
    "plain": "Write {doc}.",
    "student": "You are an undergraduate student and this is your course assignment. Write {doc}, the way a real "
               "student would write it.",
    "humanized": "Write {doc}. Make it read as written by a person: vary sentence length, avoid stock phrases such as "
                 "'delve', 'crucial' or 'in today's world', and keep lists to a minimum.",
}
WORD = " Write plain text as you would type it in Word: no Markdown. Write only the document."


def out_dir():
    return root() / "generated" / "honest"


def jobs():
    """(path, model, prompt, temperature): every topic by two models, styles in rotation."""
    rng, found = random.Random(2611), []
    for g, (genre, (doc, topics)) in enumerate(GENRES.items()):
        for i, topic in enumerate(topics):
            for j in range(2):
                model = MODELS[(i + 2 * j + g) % len(MODELS)]
                style = list(STYLES)[(i + j + g) % len(STYLES)]
                found.append((out_dir() / genre / f"{slug(topic)[:50]}-{slug(model)}-{style}.txt", model,
                              STYLES[style].format(doc=doc.format(t=topic)) + WORD, rng.choice([0.6, 1.0])))
    return found


def generate(key, log=print):
    todo = [j for j in jobs() if not j[0].exists()]
    client = httpx.Client(timeout=900)
    alive = answering(sorted({j[1] for j in todo}), key, client)
    skipped = sorted({j[1] for j in todo} - alive)
    if skipped:
        log(f"  not answering now, skipped this run: {', '.join(skipped)}")
    todo = [j for j in todo if j[1] in alive]
    random.Random(0).shuffle(todo)
    with ThreadPoolExecutor(WORKERS) as pool:
        done = sum(pool.map(lambda j: one(j, key, client, log), todo))
    return done, len(todo)


def bigpatent(n=150):
    """n patent descriptions from BigPatent's test split (classifier_data trains on its train split)."""
    from calibration.classifier_data import bigpatent as fetch
    return [text for text, _ in fetch("test", n, 60000)]


UNSEEN_LEGAL = {"validation.nlrb_decisions": "NLRB decisions", "validation.sec": "SEC documents",
                "validation.eoir": "Immigration appeal decisions (EOIR)", "validation.ftc_advisory_opinions": "FTC advisory opinions"}
LEGAL_DOCS, LEGAL_WORDS = 100, 1200  # per source, from the opening, as eval_classifier samples legal text


def unseen_legal():
    """{set name: texts} from the Pile of Law subsets classifier_data never reads, when they are in raw/pileoflaw/:
    before 2022 and not OCR-garbled, by the same rules as classifier_data.legal."""
    import lzma
    from calibration.classifier_data import ocr_broken
    sets = {}
    for stem, name in UNSEEN_LEGAL.items():
        path = root() / f"raw/pileoflaw/{stem}.jsonl.xz"
        if not path.exists():
            continue
        texts = []
        with lzma.open(path, "rt", encoding="utf-8") as f:
            for r in map(json.loads, f):
                year = re.search(r"(19|20)\d\d", str(r.get("created_timestamp") or ""))
                if not (year and int(year.group(0)) >= 2022) and not ocr_broken(r["text"]):
                    texts.append(" ".join(r["text"].split(" ")[:LEGAL_WORDS]))
        sets[f"Pile of Law, {name} (unseen source)"] = random.Random(5).sample(texts, min(LEGAL_DOCS, len(texts)))
    return sets


def prepared(text):
    """Joined hard-wrapped lines and folded typography, as classifier_data.cut prepares a text."""
    from text import normalize
    return plain(normalize(re.sub(r"(?<!\n)\n(?!\n)", " ", text)))


def score(model=None, threshold=None, log=print):
    import main as worker
    worker.load_env(worker.HERE / ".env")
    from ai import analyse
    from classifier import Classifier
    from text import bibliography_start
    scorer = Classifier(model, threshold=threshold)
    th = scorer.threshold

    def doc(text):
        t = prepared(text)
        r = analyse(t, bibliography_start(t), scorer, th)
        if r.status != "done":
            return None
        from ai import prose_sentences, windows
        n = len(windows(prose_sentences(t, bibliography_start(t))))
        return r.score, len(r.segments), n

    ai = {}
    for p in sorted(out_dir().glob("*/*.txt")):
        model = next(m for m in MODELS if slug(m) in p.stem)
        style = p.stem.rsplit("-", 1)[1]
        ai.setdefault(p.parent.name, []).append((model, style, p.stem, doc(p.read_text(encoding="utf-8"))))
    human = {"BigPatent test (patents, pre-2019)": [doc(t) for t in bigpatent()]}
    human.update({name: [doc(t) for t in texts] for name, texts in unseen_legal().items()})
    for f in sorted((root() / "raw" / "honest").glob("*.jsonl")):
        human[f.stem] = [doc(json.loads(line)["text"]) for line in f.open(encoding="utf-8")]

    def summary(results):
        got = [r for r in results if r]
        flagged, windows_ = sum(r[1] for r in got), sum(r[2] for r in got)
        shown = sum(r[0] >= SHOWN for r in got)
        return len(got), f"{100 * flagged / max(windows_, 1):.1f}% of {windows_}", shown

    lines = [f"# Honest test: classifier {scorer.path} at threshold {th}", "",
             "AI papers on invented topics by models the classifier never trained on. A paper counts as caught when "
             f"S14 would show its score ({SHOWN}% or more).", "",
             "| Genre | Model | Papers | Windows flagged | Papers caught |", "|---|---|---|---|---|"]
    for genre, rows in ai.items():
        for model in dict.fromkeys(MODELS):
            n, w, shown = summary([r for m, _, _, r in rows if m == model])
            if n:
                lines.append(f"| {genre} | {model} | {n} | {w} | {shown} of {n} |")
        n, w, shown = summary([r for *_, r in rows])
        lines.append(f"| **{genre}, all** | | {n} | {w} | **{shown} of {n}** |")
    lines += ["", "| Style | Papers | Windows flagged | Papers caught |", "|---|---|---|---|"]
    for style in STYLES:
        n, w, shown = summary([r for rows in ai.values() for _, s, _, r in rows if s == style])
        lines.append(f"| {style} | {n} | {w} | {shown} of {n} |")
    lines += ["", "Human documents (a document counts as falsely flagged when S14 would show its score):", "",
              "| Set | Documents | Windows flagged | Documents falsely flagged |", "|---|---|---|---|"]
    for name, results in human.items():
        n, w, shown = summary(results)
        lines.append(f"| {name} | {n} | {w} | {shown} of {n} |")
    # WasItAIGenerated's held-out half: other model families and humanizers. Texts are short (median ~260 words,
    # under S14's 300), so only windows are counted.
    from calibration.classifier_data import WASITAI_TEST, cut, in_test, wasitai
    groups = {}
    for key, label, group, generator, text in wasitai():
        if in_test(key, WASITAI_TEST):
            name = group if not group.startswith("ai_raw") else f"ai_raw: {(generator or 'other').split('-')[0]}"
            groups.setdefault((label, name), []).extend(cut(text))
    lines += ["", f"WasItAIGenerated 2026-09, held-out half (in_test {WASITAI_TEST}), windows flagged:", "",
              "| Group | Label | Windows | Flagged |", "|---|---|---|---|"]
    for (label, name), ws in sorted(groups.items()):
        flagged = sum(s < th for s in scorer(ws)) if ws else 0
        lines.append(f"| {name} | {'AI' if label else 'human'} | {len(ws)} | {100 * flagged / max(len(ws), 1):.1f}% |")
    lines += ["", "Every AI paper: score, windows flagged / windows.", ""]
    lines += [f"- {genre}/{stem}: {r[0]}%, {r[1]}/{r[2]}" if r else f"- {genre}/{stem}: no estimate"
              for genre, rows in ai.items() for _, _, stem, r in rows]
    text = "\n".join(lines) + "\n"
    name = f"report-honest-{Path(model).name}.md" if model else "report-honest.md"
    (root().parent / name).write_text(text, encoding="utf-8")
    log(text)


if __name__ == "__main__":
    import main
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--score", action="store_true")
    parser.add_argument("--model", help="classifier folder to score (default: the deployed one)")
    parser.add_argument("--threshold", type=float, help="its threshold (default AI_CLASSIFIER_THRESHOLD)")
    args = parser.parse_args()
    if args.generate:
        main.load_env(main.HERE / ".env")
        key = os.environ.get("NVIDIA_API_KEY") or exit("Put NVIDIA_API_KEY in worker/.env first.")
        done, total = generate(key)
        print(f"wrote {done} of {total}; run it again to retry the rest")
    if args.score:
        score(args.model, args.threshold)

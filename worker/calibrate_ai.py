"""Set the AI-writing threshold on real essays.

    python calibrate_ai.py [--human <folder> | --sample 300] [--ai <folder>] [--max-rate 0.01]

Human side: by default 300 PERSUADE 2.0 student essays (calibration.persuade.sample), or a folder.
AI side: data/calibration/ai/, or a folder. Folders may hold .txt .docx .pdf .rtf .odt files.

Every window of both sides is scored with Binoculars on this PC. The threshold is the highest one
under which at most --max-rate of the human windows fall. A strict "none of them" stops meaning
much with hundreds of essays, since one odd essay would set the bar. It reports how many AI windows
and whole AI essays that catches, and which human essays would score 20% or more; it writes
data/calibration/report.md and prints the two lines for worker/.env.
"""
import argparse
import pathlib
import time

from ai import MIN_WORDS, prose_sentences, windows
from calibration import data_dir
from extract import read_file
from score import percent
from text import normalize

SUFFIXES = {".txt", ".docx", ".pdf", ".rtf", ".odt"}
SHOWN = 20  # S14 shows an estimate under 20% as * and no highlights
CHUNK = 32  # windows per scorer call: in swap mode each call keeps ~70 MB a window in RAM


def read_folder(folder):
    """{file name: normalized text} for every supported file in the folder."""
    return {p.name: normalize(read_file(p)[0]) for p in sorted(pathlib.Path(folder).iterdir()) if p.suffix.lower() in SUFFIXES}


def threshold_for(scores, max_rate):
    """(threshold, share of scores under it): the highest threshold with at most max_rate under it."""
    ordered = sorted(scores)
    threshold = ordered[int(max_rate * len(ordered))]
    return threshold, sum(s < threshold for s in ordered) / len(ordered)


def _windows(texts):
    """{name: (window texts, window word counts, qualifying words)}"""
    out = {}
    for name, text in texts.items():
        groups = windows(prose_sentences(text))
        out[name] = ([" ".join(text[a:b] for a, b, _ in g) for g in groups], [sum(c for *_, c in g) for g in groups],
                     sum(c for g in groups for *_, c in g))
    return out


def _score_all(cut, scorer, log):
    flat = [t for texts, _, _ in cut.values() for t in texts]
    scores = []
    for i in range(0, len(flat), CHUNK):
        scores += scorer(flat[i:i + CHUNK])
        log(f"  scored {len(scores)} of {len(flat)} windows")
    it = iter(scores)
    return {name: [next(it) for _ in texts] for name, (texts, _, _) in cut.items()}


def _essay_score(counts, scores, qualifying, threshold):
    """The share S14 would show, or None when the draft has too little prose for an estimate."""
    if qualifying < MIN_WORDS:
        return None
    return percent(sum(n for n, s in zip(counts, scores) if s < threshold), qualifying)


def calibrate(human, ai, scorer, max_rate=0.01, log=lambda *a: None):
    h_cut, a_cut = _windows(human), _windows(ai)
    h_scores, a_scores = _score_all(h_cut, scorer, log), _score_all(a_cut, scorer, log)
    threshold, rate = threshold_for([s for v in h_scores.values() for s in v], max_rate)
    h_essays = {n: _essay_score(h_cut[n][1], h_scores[n], h_cut[n][2], threshold) for n in human}
    a_essays = {n: _essay_score(a_cut[n][1], a_scores[n], a_cut[n][2], threshold) for n in ai}
    a_flat = [s for v in a_scores.values() for s in v]
    return {
        "threshold": threshold, "false_positive_rate": rate, "max_rate": max_rate,
        "human_essays": len(human), "human_windows": sum(len(v) for v in h_scores.values()),
        "ai_essays": len(ai), "ai_windows": len(a_flat), "ai_windows_caught": sum(s < threshold for s in a_flat),
        "ai_essays_scored": sum(v is not None for v in a_essays.values()),
        "ai_essays_flagged": sum(v is not None and v >= SHOWN for v in a_essays.values()),
        "ai_essay_scores": a_essays,
        "human_essays_flagged": sorted((n, v) for n, v in h_essays.items() if v is not None and v >= SHOWN),
        "human_scores": sorted(s for v in h_scores.values() for s in v), "ai_scores": sorted(a_flat),
    }


def _quantiles(scores):
    q = lambda f: scores[min(len(scores) - 1, int(f * len(scores)))]  # noqa: E731
    return f"min {scores[0]:.3f}, 5% {q(0.05):.3f}, median {q(0.5):.3f}, 95% {q(0.95):.3f}, max {scores[-1]:.3f}"


def report(r, human_source, model=""):
    pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "n/a"  # noqa: E731
    flagged = "\n".join(f"- {n}: {v}%" for n, v in r["human_essays_flagged"]) or "- none"
    ai_list = "\n".join(f"- {n}: {'too short to score' if v is None else f'{v}%'}" for n, v in sorted(r["ai_essay_scores"].items()))
    return f"""# AI-writing calibration

{model}

## Data

- **Human:** {r['human_essays']} essays, {r['human_windows']} windows ({human_source}). PERSUADE 2.0: Crossley, S. A.,
  Baffour, P., Tian, Y., Franklin, A., Benner, M., & Boser, U. (2024). A large-scale corpus for assessing written
  argumentation: PERSUADE 2.0. *Assessing Writing*, 61. CC BY 4.0, https://github.com/scrosseye/persuade_corpus_2.0
- **AI:** {r['ai_essays']} essays, {r['ai_windows']} windows, written by free OpenRouter models on the same prompts.

## Threshold

The highest Binoculars score under which at most {100 * r['max_rate']:g}% of human windows fall: **{r['threshold']:.4f}**.
Measured on these essays: {pct(r['false_positive_rate'] * r['human_windows'], r['human_windows'])} of human windows fall under it.

- Human windows: {_quantiles(r['human_scores'])}
- AI windows: {_quantiles(r['ai_scores'])}

## What it catches

- AI windows under the threshold: {r['ai_windows_caught']} of {r['ai_windows']} ({pct(r['ai_windows_caught'], r['ai_windows'])}).
- Whole AI essays scoring {SHOWN}% or more: {r['ai_essays_flagged']} of the {r['ai_essays_scored']} long enough to score
  ({pct(r['ai_essays_flagged'], r['ai_essays_scored'])}).
- Human essays that would score {SHOWN}% or more ({len(r['human_essays_flagged'])} of {r['human_essays']}):
{flagged}

Each AI essay's score at this threshold:
{ai_list}

These are the essays the threshold was set on, so the human rate is in-sample; on new writing expect
it to be somewhat higher. Short windows, non-native writing and very formulaic prose score lower
(more machine-like) than typical student essays.

## worker/.env

```
AI_THRESHOLD={r['threshold']}
AI_FALSE_POSITIVE_RATE={r['false_positive_rate']}
AI_DETECTION_RATE={r['ai_essays_flagged'] / r['ai_essays_scored'] if r['ai_essays_scored'] else 0.0}
```
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--human", help="folder of human-written essays instead of PERSUADE")
    parser.add_argument("--sample", type=int, default=300, help="PERSUADE essays to use (default 300)")
    parser.add_argument("--ai", default=str(data_dir() / "ai"), help="folder of AI-written essays")
    parser.add_argument("--max-rate", type=float, default=0.01, help="share of human windows allowed under it")
    args = parser.parse_args()

    import main as worker  # loads AI_OBSERVER and friends from worker/.env
    worker.load_env(worker.HERE / ".env")
    from binoculars import Binoculars
    from calibration import persuade

    if args.human:
        human, source = read_folder(args.human), f"files in {args.human}"
    else:
        human = {e["id"]: normalize(e["text"]) for e in persuade.sample(n=args.sample)}
        source = f"a fixed sample of {len(human)} PERSUADE 2.0 essays, {args.sample // 15} per prompt"
    ai = read_folder(args.ai)
    scorer = Binoculars(threshold=1.0)  # the threshold is what is being found; this value is unused
    start = time.perf_counter()
    r = calibrate(human, ai, scorer, args.max_rate, log=print)
    model = (f"Scored with Binoculars ({scorer.observer_name} / {scorer.performer_name}, {scorer.mode} mode)"
             f" in {time.perf_counter() - start:.0f} s.")
    text = report(r, source, model)
    (data_dir() / "report.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

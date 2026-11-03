"""An LLM judge instead of Binoculars, on the same calibration data: a large model on NVIDIA's free API
rates each window 0-100 for "written by AI", and calibrate_ai sets the threshold on those ratings.

    python -m calibration.judge_ai [--model nvidia/nemotron-3-ultra-550b-a55b] [--sample 300]    from worker/

An experiment only (T13 follow-up). It sends PERSUADE essays and the generated AI essays, never a draft:
using a judge on drafts would send them off this PC. Ratings are saved after every request in
data/calibration/judge-{model}.json, so a stopped run carries on where it left off. Writes
data/calibration/report-judge.md; scores there are minus the rating, so lower still means more AI.
"""
import argparse
import hashlib
import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

from calibration import data_dir

API = "https://integrate.api.nvidia.com/v1/chat/completions"
MODEL = "nvidia/nemotron-3-ultra-550b-a55b"
BATCH = 8      # windows per request, drawn at random from all essays so no batch shows one essay whole
PAUSE = 1.6    # seconds between requests: under NVIDIA's 40 a minute
WORKERS = 4    # requests in flight; one free key ran 6 at once without queueing (tested 2026-10-29)
TRIES = 4
RETRY_WAIT = 20

PROMPT = """Each passage below is an excerpt from a separate essay. Some were written by US students in grades 6 to 12,
others by an AI language model asked to write as such a student. For each passage, estimate the probability (0 to 100)
that an AI language model wrote it. Judge each passage on its own.

Reply with only a JSON object mapping each passage number to an integer, like {{"1": 15, "2": 80}}.

{passages}"""


def key_of(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def parse(content, n):
    """{passage number: rating} from the model's reply, or {} when it isn't the JSON asked for."""
    m = re.search(r"\{[^{}]*\}", content or "")
    try:
        d = json.loads(m.group(0)) if m else {}
    except ValueError:
        return {}
    out = {}
    for k, v in d.items():
        try:
            i, r = int(k), float(v)
        except (TypeError, ValueError):
            continue
        if 1 <= i <= n and 0 <= r <= 100:
            out[i] = r
    return out


def _rate(batch, client, key, model, log):
    """{passage number: rating} for one batch of (hash, text)."""
    passages = "\n\n".join(f"Passage {j}:\n{t}" for j, (_, t) in enumerate(batch, 1))
    for attempt in range(TRIES):
        if attempt:
            time.sleep(RETRY_WAIT)
        try:
            r = client.post(API, headers={"authorization": f"Bearer {key}"},
                            json={"model": model, "temperature": 0, "max_tokens": 16000,  # it reasons first
                                  "messages": [{"role": "user", "content": PROMPT.format(passages=passages)}]})
        except httpx.HTTPError as e:
            log(f"  request failed: {e}")
            continue
        if r.status_code == 200:
            break
        log(f"  {r.status_code}: {r.text[:200]}")
    else:
        raise SystemExit("NVIDIA kept refusing; run it again later, it carries on where it stopped.")
    choice = r.json()["choices"][0]
    ratings = parse(choice["message"].get("content"), len(batch))
    if len(ratings) < len(batch):
        log(f"  short reply ({choice.get('finish_reason')}): {(choice['message'].get('content') or '')[:200]!r}")
    return ratings


def judge(texts, cache, path, key, model=MODEL, client=None, workers=WORKERS, log=print):
    """Rates every text not in cache, WORKERS requests at a time, saving cache to path after each one."""
    client = client or httpx.Client(timeout=600)
    todo = sorted({key_of(t): t for t in texts if key_of(t) not in cache}.items())
    random.Random(2026).shuffle(todo)
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    left = len(todo)
    with ThreadPoolExecutor(workers) as pool:
        futures = {}
        for b in batches:
            futures[pool.submit(_rate, b, client, key, model, log)] = b
            time.sleep(PAUSE)  # staggered starts keep it under 40 a minute
        for f in as_completed(futures):
            batch, ratings = futures[f], f.result()
            cache.update({h: ratings[j] for j, (h, _) in enumerate(batch, 1) if j in ratings})
            path.write_text(json.dumps(cache), encoding="utf-8")
            left -= len(batch)
            log(f"  rated {len(ratings)} of {len(batch)}; {len(cache)} cached, {left} left")


def main():
    import calibrate_ai
    import main as worker
    from calibration import persuade
    from text import normalize

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--sample", type=int, default=300)
    parser.add_argument("--max-rate", type=float, default=0.01)
    args = parser.parse_args()
    worker.load_env(worker.HERE / ".env")
    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        raise SystemExit("Put NVIDIA_API_KEY in worker/.env first.")

    human = {e["id"]: normalize(e["text"]) for e in persuade.sample(n=args.sample)}
    ai = calibrate_ai.read_folder(data_dir() / "ai")
    cut = calibrate_ai._windows({**human, **ai})
    texts = [t for ws, _, _ in cut.values() for t in ws]
    path = data_dir() / f"judge-{args.model.replace('/', '_')}.json"
    cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    start = time.perf_counter()
    for _ in range(3):  # a reply that skipped passages leaves them for the next round
        judge(texts, cache, path, key, args.model)
        if all(key_of(t) in cache for t in texts):
            break
    missing = sum(key_of(t) not in cache for t in texts)
    if missing:
        raise SystemExit(f"{missing} windows still unrated; run it again.")

    scorer = lambda ts: [-cache[key_of(t)] for t in ts]  # noqa: E731
    r = calibrate_ai.calibrate(human, ai, scorer, args.max_rate)
    # The judge may recognise its own writing, so split what it caught by who wrote the AI essay.
    maker = lambda name: args.model.split("/")[-1] in name  # noqa: E731
    by = {True: [0, 0, 0, 0], False: [0, 0, 0, 0]}  # windows caught, windows, essays flagged, essays scored
    for name in ai:
        ws = cut[name][0]
        b = by[maker(name)]
        b[0] += sum(-cache[key_of(t)] < r["threshold"] for t in ws)
        b[1] += len(ws)
        v = r["ai_essay_scores"][name]
        b[2] += v is not None and v >= calibrate_ai.SHOWN
        b[3] += v is not None
    split = "\n".join(f"- Essays {'by' if own else 'not by'} the judge model: windows {c}/{n}, essays flagged {f}/{s}"
                      for own, (c, n, f, s) in by.items())
    model = (f"Scored by an LLM judge ({args.model} on NVIDIA's API, {BATCH} windows a request), score = -rating."
             f" Rated in {time.perf_counter() - start:.0f} s this run.\n\n{split}")
    text = calibrate_ai.report(r, f"a fixed sample of {len(human)} PERSUADE 2.0 essays", model)
    (data_dir() / "report-judge.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

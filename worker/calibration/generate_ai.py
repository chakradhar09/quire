"""The AI side of calibration: student-style essays on the 15 PERSUADE prompts, written by free
OpenRouter models, saved as data/calibration/ai/{prompt}-{model}-{n}.txt.

    python -m calibration.generate_ai [--per-prompt 1]      from worker/, after calibration.persuade

It sends only the PERSUADE assignment (and, for source-based tasks, the titles of the articles students read),
never a draft. Free models allow 20 requests a minute and about 50 a day without credits, so it
paces itself, skips essays already written, and stops with a message at the limit: run it again
later to carry on.
"""
import argparse
import json
import os
import random
import re
import time

import httpx

from calibration import data_dir
from calibration.persuade import PROMPTS

API = "https://openrouter.ai/api/v1/chat/completions"
# Free, general-purpose and from different makers (listed 2026-10-29; thinkingmachines/inkling:free
# refuses API use outside agent apps). Free lineups change, so
# AI_CALIBRATION_MODELS (comma-separated) overrides them.
MODELS = ["google/gemma-4-31b-it:free", "nvidia/nemotron-3-ultra-550b-a55b:free", "dots-studio/dots-3-note-preview:free"]
PAUSE = 3.1  # seconds between requests: under 20 a minute
PROVIDER_TRIES = 3
RETRY_WAIT = 30  # seconds before asking a busy provider again


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def prompt_text(spec, grade):
    text = (f"You are a student in grade {grade} at a school in the United States. Write the essay for this assignment. "
            "Write only the essay itself, with no title and no notes.\n\nAssignment:\n" + spec["assignment"].strip())
    if spec.get("source_text", "").strip():
        text += "\n\nThe sources you read for the assignment (their titles):\n" + spec["source_text"].strip()
    return text


def _error(r):
    try:
        return r.json().get("error", {}).get("message") or r.text[:200]
    except ValueError:
        return r.text[:200]


def generate(dest=None, key=None, models=None, per_prompt=1, client=None, pause=PAUSE, retry_wait=RETRY_WAIT, log=print):
    """Returns (essays written now, why it stopped early or None). OpenRouter's own limit (per day or per
    minute) stops the run; a 429 from the model's provider is retried, then that model sits out the run."""
    dest = dest or data_dir()
    prompts = json.loads((dest / PROMPTS).read_text(encoding="utf-8"))
    out = dest / "ai"
    out.mkdir(parents=True, exist_ok=True)
    client = client or httpx.Client(timeout=180)
    rng = random.Random(2026)
    written, dead = 0, set()
    for name in sorted(prompts):
        for model in models:
            for n in range(1, per_prompt + 1):
                grade = rng.randint(6, 12)  # drawn before the skip, so a resumed run asks the same as the first
                path = out / f"{slug(name)}-{slug(model)}-{n}.txt"
                if path.exists() or model in dead:
                    continue
                for attempt in range(PROVIDER_TRIES):
                    if attempt:
                        time.sleep(retry_wait)
                    r = client.post(API, headers={"authorization": f"Bearer {key}"},
                                    json={"model": model, "messages": [{"role": "user", "content": prompt_text(prompts[name], grade)}]})
                    time.sleep(pause)
                    if r.status_code != 429:
                        break
                    if "free-models-per" in _error(r) or "Rate limit exceeded" in _error(r):
                        return written, f"OpenRouter's free limit: {_error(r)}. Run it again later; it carries on where it stopped."
                if r.status_code != 200:
                    log(f"  skipping {model}: {r.status_code} {_error(r)}")
                    dead.add(model)
                    continue
                choices = r.json().get("choices")
                if not choices:  # an error reported inside a 200
                    log(f"  skipping {model}: {_error(r)}")
                    dead.add(model)
                    continue
                essay = (choices[0]["message"].get("content") or "").strip()
                if not essay:
                    log(f"  {model} wrote nothing for {name}")
                    continue
                path.write_text(essay + "\n", encoding="utf-8")
                written += 1
                log(f"  {path.name}: {len(essay.split())} words")
    return written, None


if __name__ == "__main__":
    import main  # for load_env and the worker folder
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--per-prompt", type=int, default=1, help="essays per prompt and model (default 1: 45 in all)")
    args = parser.parse_args()
    main.load_env(main.HERE / ".env")
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("Put OPENROUTER_API_KEY in worker/.env first.")
    models = [m.strip() for m in os.environ.get("AI_CALIBRATION_MODELS", "").split(",") if m.strip()] or MODELS
    written, stopped = generate(key=key, models=models, per_prompt=args.per_prompt)
    print(f"wrote {written} essays" + (f"; stopped: {stopped}" if stopped else ""))

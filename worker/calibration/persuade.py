"""PERSUADE 2.0 (Crossley et al., 2024, Assessing Writing 61; CC BY 4.0): about 25,000 argumentative
essays by US students in grades 6 to 12, on 15 prompts, written before ChatGPT. The human side of
calibration.

    python -m calibration.persuade      from worker/: download once into data/calibration/

The authors' training CSV is 617 MB because it has one row per annotated paragraph, each carrying the
whole essay. It is read as it streams in and only one row per essay is kept (about 65 MB); the full
file is never saved.
"""
import csv
import html
import io
import json
import random
import re

import httpx

from ai import MIN_WORDS, prose_sentences
from calibration import data_dir

README = "https://github.com/scrosseye/persuade_corpus_2.0"
URL = "https://drive.usercontent.google.com/download"
PARAMS = {"id": "13phHyDzIsb0MHyJr6q-B-qIa9P2tM135", "export": "download", "confirm": "t"}
NEEDED = {"essay_id_comp", "full_text", "prompt_name", "task", "assignment", "source_text", "grade_level"}
ESSAYS = "persuade_essays.csv"
PROMPTS = "persuade_prompts.json"
FORM = re.compile(r'<form[^>]*id="download-form"[^>]*action="([^"]+)"(.*?)</form>', re.S)
HIDDEN = re.compile(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"')


class _Chunks(io.RawIOBase):
    """A file-like view of a byte iterator, so csv can read a download as it arrives."""

    def __init__(self, chunks):
        self.chunks, self.buf = chunks, b""

    def readable(self):
        return True

    def readinto(self, b):
        while not self.buf:
            self.buf = next(self.chunks, None)
            if self.buf is None:
                return 0
        n = min(len(b), len(self.buf))
        b[:n], self.buf = self.buf[:n], self.buf[n:]
        return n


def _not_the_corpus(why):
    return RuntimeError(f"{why}. Download the training set by hand from the link in {README} and tell me where it is.")


def download(dest=None, client=None):
    """Fetch the corpus into dest (data/calibration/ by default). Returns the number of essays kept."""
    dest = dest or data_dir()
    dest.mkdir(parents=True, exist_ok=True)
    client = client or httpx.Client(timeout=httpx.Timeout(60, read=300))
    url, params = URL, PARAMS
    for _ in range(2):  # Drive may first answer with a "can't scan this file for viruses" page
        with client.stream("GET", url, params=params, follow_redirects=True) as r:
            r.raise_for_status()
            if "text/html" in r.headers.get("content-type", ""):
                page = r.read().decode("utf-8", "replace")
                form = FORM.search(page)
                if not form:
                    raise _not_the_corpus("Google Drive answered with a page instead of the file")
                url, params = html.unescape(form.group(1)), {k: html.unescape(v) for k, v in HIDDEN.findall(form.group(2))}
                continue
            return _keep_one_row_per_essay(_resuming(client, url, params, r), dest)
    raise _not_the_corpus("Google Drive kept asking for confirmation")


def _resuming(client, url, params, r, attempts=20):
    """The body's bytes; when Drive drops the connection part way, ask for the rest with a Range header."""
    got = 0
    try:
        for _ in range(attempts):
            try:
                for chunk in r.iter_bytes():
                    got += len(chunk)
                    yield chunk
                return
            except httpx.TransportError as e:
                print(f"  connection dropped after {got / 1e6:.0f} MB ({type(e).__name__}); resuming")
                r.close()
                r = client.send(client.build_request("GET", url, params=params, headers={"range": f"bytes={got}-"}),
                                stream=True, follow_redirects=True)
                if r.status_code != 206:
                    raise _not_the_corpus(f"Google Drive would not resume the download ({r.status_code})") from e
        raise _not_the_corpus(f"Google Drive dropped the connection {attempts} times")
    finally:
        r.close()


def _keep_one_row_per_essay(chunks, dest):
    csv.field_size_limit(2**31 - 1)  # sys.maxsize overflows a C long on Windows
    text = io.TextIOWrapper(io.BufferedReader(_Chunks(chunks), 1 << 20), encoding="utf-8", errors="replace", newline="")
    rows = csv.DictReader(text)
    if not NEEDED <= set(rows.fieldnames or ()):
        raise _not_the_corpus(f"The file has no {', '.join(sorted(NEEDED - set(rows.fieldnames or ())))} column")
    part = dest / (ESSAYS + ".part")
    seen, prompts = set(), {}
    try:
        with part.open("w", encoding="utf-8", newline="") as f:
            out = csv.DictWriter(f, fieldnames=["id", "prompt", "grade", "text"])
            out.writeheader()
            for row in rows:
                if row["essay_id_comp"] in seen:
                    continue
                seen.add(row["essay_id_comp"])
                prompts.setdefault(row["prompt_name"], {k: row[k] for k in ("task", "assignment", "source_text")})
                out.writerow({"id": row["essay_id_comp"], "prompt": row["prompt_name"], "grade": row["grade_level"],
                              "text": row["full_text"]})
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    part.replace(dest / ESSAYS)
    (dest / PROMPTS).write_text(json.dumps(prompts, indent=1), encoding="utf-8")
    return len(seen)


def sample(dest=None, n=300, seed=2026):
    """n essays with at least 300 words of prose, taken in turn from each prompt. The same every run."""
    csv.field_size_limit(2**31 - 1)  # sys.maxsize overflows a C long on Windows
    by_prompt = {}
    with ((dest or data_dir()) / ESSAYS).open(encoding="utf-8", newline="") as f:
        for e in csv.DictReader(f):
            if sum(c for *_, c in prose_sentences(e["text"])) >= MIN_WORDS:
                by_prompt.setdefault(e["prompt"], []).append(e)
    rng = random.Random(seed)
    queues = []
    for prompt in sorted(by_prompt):
        essays = sorted(by_prompt[prompt], key=lambda e: e["id"])
        rng.shuffle(essays)
        queues.append(essays)
    picked = []
    while len(picked) < n and any(queues):
        for q in queues:
            if q and len(picked) < n:
                picked.append(q.pop())
    return picked


if __name__ == "__main__":
    print(f"downloading PERSUADE 2.0 (617 MB, CC BY 4.0) from the authors' Google Drive into {data_dir()} ...")
    print(f"kept {download()} essays")

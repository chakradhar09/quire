"""The AI-writing estimate: which stretches of prose read as machine-written.

Only prose counts: sentences of at least 6 words ending in . ? or !, on lines that are not list
items, before the reference list. Under 300 such words, or not English, there is no estimate.
The prose is cut into windows of consecutive sentences (about 160 words each); the scorer gives
each window a number, lower meaning more machine-like (Binoculars), and a window under the
threshold becomes an 'ai' segment. The score is the share of qualifying words inside them.

The scorer is a plain argument, so everything here is tested without a model.
"""
import re
from dataclasses import dataclass, field

import py3langid

from score import percent
from text import words

MIN_WORDS = 300
SENTENCE_WORDS = 6
WINDOW_WORDS = 160
SENTENCE = re.compile(r"[^.!?\s][^.!?]*[.!?]+[\"'”’)\]]*")
LIST_ITEM = re.compile(r"^\s*(?:[-*•–▪]|\d+[.)]|[a-zA-Z][.)])\s")
CELL = re.compile(r"[^\t]+")
# Table cells in the estimate: off, as in Turnitin, until the human false-flag rate with them is measured.
TABLES = False


@dataclass
class AiResult:
    status: str                 # done | unavailable
    reason: str | None          # too_few_words | unsupported_language
    qualifying_words: int
    segments: list = field(default_factory=list)  # [{start, end, label, p}]
    score: float | None = None


def prose_sentences(text, bibliography_start=None, tables=TABLES):
    """(start, end, word count) of every prose sentence, in order. A table row (extract puts a tab between
    cells) counts only with tables=True, and then only its cells' own sentences, never one run across cells."""
    end_of_prose = len(text) if bibliography_start is None else bibliography_start
    found, pos = [], 0
    for line in text.split("\n"):
        row = "\t" in line.strip()
        if not LIST_ITEM.match(line) and (tables or not row):
            for cell in (CELL.finditer(line) if row else [re.match(r".*", line)]):
                for m in SENTENCE.finditer(cell.group()):
                    start, end = pos + cell.start() + m.start(), pos + cell.start() + m.end()
                    n = len(words(m.group()))
                    if start < end_of_prose and n >= SENTENCE_WORDS:
                        found.append((start, end, n))
        pos += len(line) + 1
    return found


def windows(sentences, target=WINDOW_WORDS):
    """Consecutive sentences in groups of about `target` words: the total is split into
    round(total / target) parts, cutting before the sentence whose middle passes each boundary."""
    total = sum(n for *_, n in sentences)
    parts = max(1, round(total / target))
    groups, current, done = [], [], 0
    for s in sentences:
        boundary = (len(groups) + 1) * total / parts
        if current and len(groups) < parts - 1 and done + s[2] / 2 >= boundary:
            groups.append(current)
            current = []
        current.append(s)
        done += s[2]
    return groups + [current] if current else groups


def analyse(text, bibliography_start, scorer, threshold):
    sentences = prose_sentences(text, bibliography_start)
    qualifying = sum(n for *_, n in sentences)
    if qualifying < MIN_WORDS:
        return AiResult("unavailable", "too_few_words", qualifying)
    if py3langid.classify(" ".join(text[a:b] for a, b, _ in sentences))[0] != "en":
        return AiResult("unavailable", "unsupported_language", qualifying)
    groups = windows(sentences)
    values = scorer([" ".join(text[a:b] for a, b, _ in g) for g in groups])
    segments, ai_words = [], 0
    for g, value in zip(groups, values):
        if value < threshold:
            segments.append({"start": g[0][0], "end": g[-1][1], "label": "ai", "p": round(float(value), 4)})
            ai_words += sum(n for *_, n in g)
    return AiResult("done", None, qualifying, segments, percent(ai_words, qualifying))

"""Find the passages a draft shares with a source: exact runs of 8 or more words.

Words are text.words() tokens, compared case-insensitively, so punctuation and case changes
still match. Winnowing (word 5-grams, window 4) picks fingerprints in both texts; any shared
run of 8+ words is guaranteed to share one (k + w - 1 = 8). Each shared fingerprint is a seed,
extended forward and back to the longest exact run.
"""
import hashlib
from dataclasses import dataclass

from text import words

K = 5          # words per gram
W = 4          # grams per winnowing window
MIN_WORDS = 8  # = K + W - 1, the run length winnowing never misses


@dataclass
class Match:
    doc_start: int   # character offsets into the draft
    doc_end: int
    src_start: int   # character offsets into the source
    src_end: int
    word_count: int
    doc_words: tuple  # (first, end) word indices in the draft, for scoring


def tokens(text):
    return [(a, b, text[a:b].casefold()) for a, b in words(text)]


def gram_hash(toks, i):
    """Signed 64-bit, so it fits an SQLite INTEGER (library fingerprints, M3)."""
    gram = " ".join(t[2] for t in toks[i:i + K]).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(gram, digest_size=8).digest(), "big", signed=True)


def winnow(hashes):
    """{hash: [positions]} picked by winnowing: the rightmost minimum of every window."""
    picked, last = {}, -1
    for start in range(max(1, len(hashes) - W + 1)) if hashes else ():
        window = range(start, min(start + W, len(hashes)))
        pos = min(window, key=lambda i: (hashes[i], -i))
        if pos != last:
            picked.setdefault(hashes[pos], []).append(pos)
            last = pos
    return picked


def align(doc_text, src_text):
    d, s = tokens(doc_text), tokens(src_text)
    src_fp = winnow([gram_hash(s, i) for i in range(len(s) - K + 1)])
    doc_fp = winnow([gram_hash(d, i) for i in range(len(d) - K + 1)])

    runs = set()
    for h, doc_positions in doc_fp.items():
        for q in src_fp.get(h, ()):
            for p in doc_positions:
                if any(d[p + j][2] != s[q + j][2] for j in range(K)):
                    continue  # hash collision
                ps, qs, pe, qe = p, q, p + K, q + K
                while ps > 0 and qs > 0 and d[ps - 1][2] == s[qs - 1][2]:
                    ps, qs = ps - 1, qs - 1
                while pe < len(d) and qe < len(s) and d[pe][2] == s[qe][2]:
                    pe, qe = pe + 1, qe + 1
                if pe - ps >= MIN_WORDS:
                    runs.add((ps, pe, qs, qe))

    # One match per draft passage: drop runs inside a longer one (a phrase repeated in the source).
    kept = []
    for run in sorted(runs, key=lambda r: (r[0] - r[1], r[0], r[2])):
        if not any(k[0] <= run[0] and run[1] <= k[1] for k in kept):
            kept.append(run)
    return [Match(d[ps][0], d[pe - 1][1], s[qs][0], s[qe - 1][1], pe - ps, (ps, pe))
            for ps, pe, qs, qe in sorted(kept)]

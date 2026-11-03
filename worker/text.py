"""Text rules every job shares: one normalization, one notion of a word.

Every offset stored in the database points into normalize()d text.
"""
import re
import unicodedata

ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿"))
WORD = re.compile(r"\w+")


def normalize(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return unicodedata.normalize("NFKC", text).translate(ZERO_WIDTH)


def words(text):
    """(start, end) character offsets of every word."""
    return [m.span() for m in WORD.finditer(text)]


MAX_QUOTE = 1200
OPENS_AFTER = frozenset(" \t\n([{—–-")


def quote_spans(text):
    """(start, end) of every double-quoted passage, marks included. A straight quote opens after
    a space or bracket and closes otherwise; an opener with no closer before the next opener is dropped."""
    spans, opener = [], None
    for i, ch in enumerate(text):
        if ch == "“" or (ch == '"' and (i == 0 or text[i - 1] in OPENS_AFTER)):
            opener = i
        elif ch in '"”' and opener is not None:
            if i + 1 - opener <= MAX_QUOTE and "\n\n" not in text[opener:i]:
                spans.append((opener, i + 1))
            opener = None
    return spans


def in_quote(start, end, spans):
    """At least half of [start, end) lies inside the quote spans."""
    inside = sum(max(0, min(end, b) - max(start, a)) for a, b in spans)
    return 2 * inside >= end - start


HEADING = re.compile(r"^[ \t]*(?:(?:\d+|(?-i:[IVXLC]+))\.?[ \t]*)?(?:references|bibliography|works cited|sources|literature cited)"
                     r"[ \t]*:?[ \t]*$", re.IGNORECASE | re.MULTILINE)


def bibliography_start(text):
    """Offset of the last reference-list heading line in the final 40% of the text, or None."""
    found = [m.start() for m in HEADING.finditer(text) if m.start() >= 0.6 * len(text)]
    return found[-1] if found else None


SENTENCE = re.compile(r"[^.!?\n]+(?:[.!?]+|$)")
STOPWORDS = frozenset("""a an and are as at be been but by can could did do does for from had has have
he her his how i if in into is it its may me might my no not of on one or our she should so than that
the their them then there these they this those to us was we were what when where which who will with
would you your""".split())


MAX_QUERY = 400  # characters Brave accepts in one query
NO_QUOTES = dict.fromkeys(map(ord, '"“”'), " ")  # Brave reads double quotes as an exact phrase


def pick_queries(text, budget):
    """Web queries: each searchable sentence (12-40 words, not mostly filler) as it stands, without
    quotes, spread evenly over the draft, at most `budget` of them. Brave's quoted-phrase search
    missed a copied Wikipedia sentence that the plain sentence found as its first result (CP4)."""
    if budget <= 0:
        return []
    found = []
    for m in SENTENCE.finditer(text):
        sentence = " ".join(m.group().translate(NO_QUOTES).split())
        tokens = [sentence[a:b] for a, b in words(sentence)]
        if not 12 <= len(tokens) <= 40:
            continue
        if sum(t.casefold() in STOPWORDS for t in tokens) / len(tokens) > 0.6:
            continue
        query = sentence if len(sentence) <= MAX_QUERY else sentence[:sentence.rfind(" ", 0, MAX_QUERY + 1)]
        if query not in found:
            found.append(query)
    if len(found) <= budget:
        return found
    step = len(found) / budget
    return [found[int(i * step)] for i in range(budget)]

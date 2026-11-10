"""The draft's reference list, one entry at a time: where each entry is, the title it cites, and whether
OpenAlex (a free, open catalogue of scholarly works) knows a work by that title.

Offsets are into the normalized draft text, like every other offset in the database.
"""
import difflib
import re
import time

from text import WORD

MARKER = re.compile(r"^[ \t]*(?:\[\d{1,3}\]|\d{1,3}[.)])[ \t]+")
YEAR = re.compile(r"\b(?:1[89]|20)\d{2}[a-z]?\b|\bn\.\s?d\.")
# APA: Author, A. (2020). Title of the work. Container...  (also "(2020, May 3)." and "(n.d.).")
# The title ends at its first full stop, question or exclamation mark: what follows ("arXiv preprint.",
# "In Proceedings...") is the container.
APA_TITLE = re.compile(r"\((?:(?:1[89]|20)\d{2}[a-z]?(?:,[^)]{0,30})?|n\.\s?d\.)\)\.?\s+(.+?[.?!])(?=\s|$)")
# IEEE and MLA put the title in quotes; the closing quote may come after the comma or period.
QUOTED = re.compile(r"[“\"]([^”\"]{12,300}?)[,.]?[”\"]")
MAX_ENTRY = 1500


def split_references(text, bib):
    """(start, end) of each entry after the reference-list heading at `bib`. A list numbered [1] or 1.
    splits at its numbers; otherwise every line that has a year starts an entry and lines without one
    continue it (a PDF wraps long entries). Lines before the first entry (the heading, a note) are skipped."""
    if bib is None:
        return []
    lines, pos = [], text.find("\n", bib)
    while pos != -1 and pos < len(text):
        start = pos + 1
        end = text.find("\n", start)
        end = len(text) if end == -1 else end
        if text[start:end].strip():
            lines.append((start, end))
        pos = end if end < len(text) else -1
    numbered = sum(bool(MARKER.match(text[a:b])) for a, b in lines) >= 2
    entries = []
    for a, b in lines:
        line = text[a:b]
        starts = MARKER.match(line) if numbered else YEAR.search(line)
        if starts:
            entries.append([a, b])
        elif entries and b - entries[-1][0] <= MAX_ENTRY:
            entries[-1][1] = b
    return [(a, b) for a, b in entries if YEAR.search(text[a:b])]


def title_of(entry):
    """The title an entry cites, or None: the quoted one (IEEE, MLA), else the sentence after the year (APA)."""
    entry = MARKER.sub("", entry, count=1).strip()
    quoted = QUOTED.search(entry)
    if quoted and len(WORD.findall(quoted.group(1))) >= 3:
        return quoted.group(1).strip()
    apa = APA_TITLE.search(entry)
    if apa:
        title = apa.group(1).rstrip(".").strip()
        if len(WORD.findall(title)) >= 3:
            return title
    return None


def _tokens(title):
    return [w.casefold() for w in WORD.findall(title)]


def same_title(ours, theirs):
    """The same work: nearly the same words, or one title is the other plus a subtitle."""
    a, b = _tokens(ours), _tokens(theirs)
    if not a or not b:
        return False
    if difflib.SequenceMatcher(None, a, b).ratio() >= 0.9:
        return True
    short, long = sorted((a, b), key=len)
    return len(short) >= 5 and long[:len(short)] == short


def abstract_text(inverted):
    """OpenAlex keeps abstracts as {word: [positions]}; this puts the words back in order."""
    if not inverted:
        return ""
    placed = sorted((p, w) for w, ps in inverted.items() for p in ps)
    return " ".join(w for _, w in placed)


class OpenAlex:
    """Looks a title up in OpenAlex: the best-matching work, or None. No key, no account; only the title
    is sent. https://docs.openalex.org"""

    API = "https://api.openalex.org/works"

    def __init__(self, client, spacing=0.2):
        self.client = client
        self.spacing = spacing  # well under OpenAlex's 10 requests a second
        self.last = 0.0

    def __call__(self, title):
        wait = self.last + self.spacing - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        r = self.client.get(self.API, params={
            "search": title, "per_page": 3,
            "select": "id,doi,display_name,publication_year,abstract_inverted_index",
        }, headers={"User-Agent": "Quire (https://github.com/chakradhar09/quire)"})
        r.raise_for_status()
        for work in r.json().get("results", []):
            if work.get("display_name") and same_title(title, work["display_name"]):
                return {
                    "title": work["display_name"],
                    "url": work.get("doi") or work.get("id"),
                    "year": work.get("publication_year"),
                    "abstract": abstract_text(work.get("abstract_inverted_index")),
                }
        return None


TAG = re.compile(r"<[^>]+>")


class Crossref:
    """Looks a title up in Crossref (the DOI registry), for works OpenAlex doesn't have: the best-matching
    work, or None. No key, no account; only the title is sent. https://api.crossref.org"""

    API = "https://api.crossref.org/works"

    def __init__(self, client, spacing=0.2):
        self.client = client
        self.spacing = spacing
        self.last = 0.0

    def __call__(self, title):
        wait = self.last + self.spacing - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        r = self.client.get(self.API, params={
            "query.bibliographic": title, "rows": 3, "select": "DOI,title,subtitle,issued,abstract",
        }, headers={"User-Agent": "Quire (https://github.com/chakradhar09/quire)"})
        r.raise_for_status()
        for work in r.json().get("message", {}).get("items", []):
            name = (work.get("title") or [""])[0]
            # Crossref keeps a subtitle apart from the title.
            full = f"{name}: {work['subtitle'][0]}" if work.get("subtitle") else name
            if name and (same_title(title, full) or same_title(title, name)):
                year = (work.get("issued", {}).get("date-parts") or [[None]])[0][0]
                return {
                    "title": full,
                    "url": f"https://doi.org/{work['DOI']}" if work.get("DOI") else None,
                    "year": year,
                    "abstract": " ".join(TAG.sub(" ", work.get("abstract") or "").split()),
                }
        return None


def lookup(title, catalogues):
    """The first catalogue's match for a title, or None when none of them has it. A catalogue that fails
    (offline, rate-limited) counts as not having it."""
    for find in catalogues:
        try:
            work = find(title)
        except Exception as e:  # noqa: BLE001 - any failure of an optional lookup is a miss, not a failed check
            print(f"  reference lookup failed: {e}")
            continue
        if work:
            return work
    return None

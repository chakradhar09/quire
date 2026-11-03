"""The similarity score: every word of the draft counts once, for the best source that covers it.

Sources are ranked greedily: the one covering the most words no better source has claimed
goes next and claims them. Ties go to more matched words in total, then the lower source id.
The denominator is always the whole draft, so hiding text never inflates the score.
"""
from dataclasses import dataclass


@dataclass
class SourceScore:
    rank: int | None   # None: every word it matched was claimed by a better source
    claimed: int       # words this source is credited with
    matched: int       # words it matched at all
    percent: float     # claimed / draft words


@dataclass
class Score:
    score: float
    sources: dict


def percent(words, total):
    return round(100 * words / total, 2) if total else 0.0


def score(word_count, matches):
    """matches: {source_id: [(first_word, end_word), ...]}, half-open word-index ranges."""
    # ponytail: word sets per source, fine for drafts up to ~100k words; interval maths if that ever hurts.
    covered = {sid: {w for a, b in ranges for w in range(a, b)} for sid, ranges in matches.items()}
    claimed = set()
    sources = {}
    pending = set(covered)
    rank = 0
    while pending:
        best = max(pending, key=lambda s: (len(covered[s] - claimed), len(covered[s]), -s))
        pending.remove(best)
        gain = covered[best] - claimed
        if gain:
            claimed |= gain
            rank += 1
            sources[best] = SourceScore(rank, len(gain), len(covered[best]), percent(len(gain), word_count))
        else:
            sources[best] = SourceScore(None, 0, len(covered[best]), 0.0)
    return Score(percent(len(claimed), word_count), sources)

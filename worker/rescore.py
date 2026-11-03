"""The one scoring path: apply a report's filters and exclusions to its stored matches, then
rank and score. The similarity job ends with it and the rescore job is nothing else.

Hidden matches get the first reason that applies: match_excluded, source_excluded, quote,
bibliography; then a source whose visible matches cover fewer than small_match_words words is
hidden whole as small_source. Nothing hidden counts, and the denominator stays the whole draft.
"""
import bisect

from score import score
from text import words


def rescore(conn, report_id):
    """Call inside a write transaction."""
    text, word_count, no_quotes, no_bib, small = conn.execute(
        "select d.text, d.word_count, r.exclude_quotes, r.exclude_bibliography, r.small_match_words"
        " from similarity_reports r join documents d on d.id = r.document_id where r.id = ?", (report_id,)).fetchone()
    excluded = {sid for sid, in conn.execute(
        "select source_id from report_sources where report_id = ? and excluded = 1", (report_id,))}
    spans = words(text)
    starts, ends = [a for a, _ in spans], [b for _, b in spans]

    reasons, visible, matched = {}, {}, {}
    for mid, sid, a, b, own, quoted, listed in conn.execute(
            "select id, source_id, doc_start, doc_end, excluded, in_quote, in_bibliography from matches"
            " where report_id = ?", (report_id,)).fetchall():
        span = (bisect.bisect_right(ends, a), bisect.bisect_left(starts, b))  # character offsets to word range
        matched.setdefault(sid, set()).update(range(*span))
        reasons[mid] = ("match_excluded" if own else "source_excluded" if sid in excluded
                        else "quote" if no_quotes and quoted else "bibliography" if no_bib and listed else None)
        if reasons[mid] is None:
            visible.setdefault(sid, []).append((mid, span))

    for sid, ms in list(visible.items()):
        if len({w for _, s in ms for w in range(*s)}) < small:
            reasons.update((mid, "small_source") for mid, _ in ms)
            del visible[sid]

    result = score(word_count, {sid: [s for _, s in ms] for sid, ms in visible.items()})
    conn.executemany("update matches set hidden_reason = ? where id = ?", [(r, mid) for mid, r in reasons.items()])
    for sid, in conn.execute("select source_id from report_sources where report_id = ?", (report_id,)).fetchall():
        s = result.sources.get(sid)
        conn.execute("update report_sources set rank = ?, percent = ?, matched_words = ? where report_id = ? and source_id = ?",
                     (s and s.rank, s.percent if s else 0.0, len(matched.get(sid, ())), report_id, sid))
    conn.execute("update similarity_reports set status = 'done', score = ? where id = ?", (result.score, report_id))

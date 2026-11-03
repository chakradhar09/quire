"""The rescore rule on hand-made matches: each filter alone, exclusions, small sources, the score."""
import unittest

from db_test import TempDatabase
from rescore import rescore
from text import words

DRAFT = " ".join(f"word{i}" for i in range(100))
SPANS = words(DRAFT)


class RescoreTest(TempDatabase):
    def setUp(self):
        super().setUp()
        doc = self.add_document(status="ready", text=DRAFT, word_count=100)
        self.report = self.conn.execute(
            "insert into similarity_reports (document_id) values (?) returning id", (doc,)).fetchone()[0]
        self.a, self.b = (self.source(name) for name in "ab")

    def source(self, name):
        sid = self.conn.execute("insert into sources (type, url, text, text_hash) values ('internet', ?, 'x', 'x') returning id",
                                (f"https://{name}.example/",)).fetchone()[0]
        self.conn.execute("insert into report_sources (report_id, source_id) values (?, ?)", (self.report, sid))
        return sid

    def match(self, source, first, end, **flags):
        """A match on draft words [first, end)."""
        cols = ["report_id", "source_id", "doc_start", "doc_end", "src_start", "src_end", "word_count", "match_group", *flags]
        values = [self.report, source, SPANS[first][0], SPANS[end - 1][1], 0, 1, end - first, "not_cited_or_quoted",
                  *flags.values()]
        return self.conn.execute(f"insert into matches ({', '.join(cols)}) values ({', '.join('?' * len(cols))}) returning id",
                                 values).fetchone()[0]

    def settings(self, **cols):
        sets = ", ".join(f"{c} = ?" for c in cols)
        self.conn.execute(f"update similarity_reports set {sets} where id = ?", [*cols.values(), self.report])

    def run_rescore(self):
        rescore(self.conn, self.report)
        status, score = self.conn.execute("select status, score from similarity_reports where id = ?", (self.report,)).fetchone()
        self.assertEqual(status, "done")
        return score

    def ranked(self):
        return self.conn.execute("select source_id, rank, percent, matched_words from report_sources"
                                 " where report_id = ? order by source_id", (self.report,)).fetchall()

    def hidden(self, match_id):
        return self.conn.execute("select hidden_reason from matches where id = ?", (match_id,)).fetchone()[0]

    def test_with_every_filter_off_each_word_counts_once_for_the_best_source(self):
        self.match(self.a, 0, 20)
        self.match(self.b, 10, 25)
        self.assertEqual(self.run_rescore(), 25.0)
        self.assertEqual(self.ranked(), [(self.a, 1, 20.0, 20), (self.b, 2, 5.0, 15)])

    def test_exclude_quotes_hides_only_quoted_matches_and_only_when_on(self):
        quoted = self.match(self.a, 0, 10, in_quote=1)
        self.match(self.a, 50, 60)
        self.assertEqual(self.run_rescore(), 20.0)
        self.assertIsNone(self.hidden(quoted))

        self.settings(exclude_quotes=1)
        self.assertEqual(self.run_rescore(), 10.0)
        self.assertEqual(self.hidden(quoted), "quote")

    def test_exclude_bibliography_hides_reference_list_matches(self):
        listed = self.match(self.a, 90, 100, in_bibliography=1)
        self.match(self.b, 0, 10)
        self.settings(exclude_bibliography=1)
        self.assertEqual(self.run_rescore(), 10.0)
        self.assertEqual(self.hidden(listed), "bibliography")
        self.assertEqual(self.ranked(), [(self.a, None, 0.0, 10), (self.b, 1, 10.0, 10)])

    def test_small_sources_are_hidden_whole_and_the_threshold_counts_only_visible_words(self):
        short = [self.match(self.a, 0, 8), self.match(self.a, 20, 28)]
        quoted = self.match(self.b, 40, 50, in_quote=1)
        kept = self.match(self.b, 60, 72)
        self.settings(small_match_words=15, exclude_quotes=1)
        self.assertEqual(self.run_rescore(), 16.0, "a's 16 words pass; b has only 12 visible, so it goes")
        self.assertEqual([self.hidden(m) for m in [*short, kept]], [None, None, "small_source"])

        self.settings(small_match_words=20)
        self.assertEqual(self.run_rescore(), 0.0)
        self.assertEqual([self.hidden(m) for m in [*short, quoted, kept]], ["small_source"] * 2 + ["quote", "small_source"])

    def test_an_excluded_top_source_lets_the_next_claim_its_words_and_restoring_undoes_it(self):
        top = self.match(self.a, 0, 30)
        self.match(self.b, 10, 25)
        self.conn.execute("update report_sources set excluded = 1 where source_id = ?", (self.a,))
        self.assertEqual(self.run_rescore(), 15.0)
        self.assertEqual(self.ranked(), [(self.a, None, 0.0, 30), (self.b, 1, 15.0, 15)])
        self.assertEqual(self.hidden(top), "source_excluded")

        self.conn.execute("update report_sources set excluded = 0 where source_id = ?", (self.a,))
        self.assertEqual(self.run_rescore(), 30.0)
        self.assertEqual(self.ranked(), [(self.a, 1, 30.0, 30), (self.b, None, 0.0, 15)])
        self.assertIsNone(self.hidden(top))

    def test_reasons_follow_the_order_match_source_quote_bibliography(self):
        both = dict(in_quote=1, in_bibliography=1)
        m1 = self.match(self.a, 0, 10, excluded=1, **both)
        m2 = self.match(self.a, 20, 30, **both)
        m3 = self.match(self.b, 40, 50, **both)
        m4 = self.match(self.b, 60, 70, in_bibliography=1)
        self.conn.execute("update report_sources set excluded = 1 where source_id = ?", (self.a,))
        self.settings(exclude_quotes=1, exclude_bibliography=1)
        self.assertEqual(self.run_rescore(), 0.0)
        self.assertEqual([self.hidden(m) for m in [m1, m2, m3, m4]], ["match_excluded", "source_excluded", "quote", "bibliography"])

    def test_the_denominator_stays_the_whole_draft(self):
        self.match(self.a, 0, 50, in_quote=1)
        self.match(self.b, 50, 60)
        self.settings(exclude_quotes=1)
        self.assertEqual(self.run_rescore(), 10.0, "10 of 100 words, not 10 of the 50 left visible")

    def test_a_report_with_no_matches_scores_zero(self):
        self.assertEqual(self.run_rescore(), 0.0)


if __name__ == "__main__":
    unittest.main()

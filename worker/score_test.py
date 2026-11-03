import unittest

from score import score


class ScoreTest(unittest.TestCase):
    def test_a_source_only_gains_the_words_no_better_source_claimed(self):
        # A covers words 0-39, B covers 30-59: B is second and only gains 40-59.
        result = score(100, {1: [(0, 40)], 2: [(30, 60)]})
        self.assertEqual((result.sources[1].rank, result.sources[1].claimed, result.sources[1].percent), (1, 40, 40.0))
        self.assertEqual((result.sources[2].rank, result.sources[2].claimed, result.sources[2].matched), (2, 20, 30))
        self.assertEqual(result.score, 60.0)

    def test_ranks_by_unclaimed_words_not_by_total_words(self):
        # B matches more words in total, but most of them are A's; C has fewer but all new.
        result = score(100, {1: [(0, 50)], 2: [(10, 60)], 3: [(70, 85)]})
        self.assertEqual([result.sources[s].rank for s in (1, 2, 3)], [1, 3, 2])

    def test_a_tie_goes_to_more_total_words_then_the_lower_source_id(self):
        # After source 1 claims 0-19, sources 2, 3, 6 and 7 each gain 10 new words.
        # 2 matched 15 words in total (5 already claimed), so it wins; then 3, 6, 7 by id.
        result = score(100, {1: [(0, 20)], 2: [(15, 30)], 3: [(40, 50)], 7: [(60, 70)], 6: [(80, 90)]})
        self.assertEqual([result.sources[s].rank for s in (1, 2, 3, 6, 7)], [1, 2, 3, 4, 5])

    def test_a_source_fully_covered_by_better_ones_gets_no_rank(self):
        result = score(100, {1: [(0, 50)], 2: [(10, 20)]})
        self.assertEqual((result.sources[2].rank, result.sources[2].claimed, result.sources[2].percent), (None, 0, 0.0))
        self.assertEqual(result.sources[2].matched, 10)

    def test_overlapping_ranges_within_one_source_count_once(self):
        result = score(50, {1: [(0, 30), (20, 40)]})
        self.assertEqual(result.sources[1].matched, 40)
        self.assertEqual(result.score, 80.0)

    def test_the_score_never_exceeds_100_and_percents_add_up(self):
        result = score(30, {1: [(0, 30)], 2: [(0, 30)], 3: [(5, 25)]})
        self.assertEqual(result.score, 100.0)
        self.assertEqual(sum(s.percent for s in result.sources.values()), 100.0)

    def test_no_sources_or_no_words_scores_zero(self):
        self.assertEqual(score(100, {}).score, 0.0)
        self.assertEqual(score(0, {}).score, 0.0)

    def test_percent_is_rounded_to_two_places(self):
        self.assertEqual(score(3, {1: [(0, 1)]}).score, 33.33)


if __name__ == "__main__":
    unittest.main()

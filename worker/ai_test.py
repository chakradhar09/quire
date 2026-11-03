"""The AI-writing pipeline with a stand-in scorer: no model is ever loaded here."""
import unittest

from ai import analyse, prose_sentences, windows
from text import words


def essay(n, marker=lambda i: False):
    """n English sentences of 14 words each; marked ones carry the word 'robotic'."""
    return " ".join(f"Sentence {i} {'robotic' if marker(i) else 'describes'} how the river shapes the lives of people beside it today."
                    for i in range(n))


# Lower is more machine-like, as with Binoculars: windows mentioning 'robotic' score under the threshold.
def stand_in(texts):
    return [0.5 if "robotic" in t else 1.0 for t in texts]


THRESHOLD = 0.9


def texts_of(text, spans):
    return [text[a:b] for a, b, _ in spans]


class ProseSentencesTest(unittest.TestCase):
    def test_keeps_sentences_of_six_words_or_more_ending_in_a_full_stop_question_or_exclamation(self):
        text = "Rivers carry water down to the sea. Why do rivers bend so much over time? Too short here. No ending mark at all in this one"
        self.assertEqual(texts_of(text, prose_sentences(text)),
                         ["Rivers carry water down to the sea.", "Why do rivers bend so much over time?"])

    def test_counts_words_like_the_rest_of_the_app(self):
        text = "Rivers carry water, silt and stones down to the sea."
        (_, _, n), = prose_sentences(text)
        self.assertEqual(n, len(words(text)))

    def test_skips_list_lines_and_headings(self):
        text = ("Introduction to rivers and their many uses\n"
                "- Rivers carry water down to the sea every day.\n"
                "* Rivers carry water down to the sea every day.\n"
                "• Rivers carry water down to the sea every day.\n"
                "2. Rivers carry water down to the sea every day.\n"
                "b) Rivers carry water down to the sea every day.\n"
                "A real paragraph about rivers starts right here.")
        self.assertEqual(texts_of(text, prose_sentences(text)), ["A real paragraph about rivers starts right here."])

    def test_stops_at_the_reference_list(self):
        body = "Rivers carry water down to the sea. "
        text = body + "References\nSmith, John and Jane Doe wrote a long book about rivers."
        self.assertEqual(texts_of(text, prose_sentences(text, bibliography_start=len(body))), [body.strip()])

    def test_table_rows_are_left_out_unless_asked_for_then_only_cells_that_read_as_prose(self):
        row = "Method\tGradient boosting\tIt was trained on six months of fleet data.\t96.4%"
        text = "Rivers carry water down to the sea.\n" + row + "\n\tAn indented paragraph is still a paragraph here."
        self.assertEqual(texts_of(text, prose_sentences(text)),
                         ["Rivers carry water down to the sea.", "An indented paragraph is still a paragraph here."])
        self.assertEqual(texts_of(text, prose_sentences(text, tables=True)),
                         ["Rivers carry water down to the sea.", "It was trained on six months of fleet data.",
                          "An indented paragraph is still a paragraph here."])

    def test_never_splits_across_lines(self):
        text = "This line has no ending punctuation at all\nso this one is a separate fragment of words."
        self.assertEqual(texts_of(text, prose_sentences(text)), ["so this one is a separate fragment of words."])


class WindowsTest(unittest.TestCase):
    def test_groups_consecutive_sentences_into_120_to_200_words(self):
        sentences = prose_sentences(essay(60))  # 840 words
        groups = windows(sentences)
        sizes = [sum(n for _, _, n in g) for g in groups]
        self.assertEqual(sum(sizes), 840)
        self.assertTrue(all(120 <= s <= 200 for s in sizes), sizes)
        self.assertEqual([s for g in groups for s in g], sentences, "in order, each sentence once")

    def test_a_short_tail_joins_the_window_before_it(self):
        groups = windows(prose_sentences(essay(10)))  # 140 words, then nothing left over
        self.assertEqual(len(groups), 1)
        groups = windows(prose_sentences(essay(12)))  # 168: one window, no 28-word stub
        self.assertEqual(len(groups), 1)

    def test_one_long_sentence_is_a_window_of_its_own(self):
        long = "And " + " ".join(["more"] * 250) + " words."
        groups = windows(prose_sentences(essay(10) + " " + long + " " + essay(10)))
        self.assertEqual([len(g) for g in groups], [10, 1, 10])


class AnalyseTest(unittest.TestCase):
    def test_under_300_qualifying_words_is_unavailable(self):
        r = analyse(essay(21) + "\n- " + essay(30), None, stand_in, THRESHOLD)  # 294 words of prose, the list doesn't count
        self.assertEqual((r.status, r.reason, r.qualifying_words), ("unavailable", "too_few_words", 294))
        self.assertIsNone(r.score)

    def test_text_not_in_english_is_unavailable(self):
        french = " ".join(f"Les gens qui vivent près de la rivière parlent souvent de la pluie et du vent {i}."
                          for i in range(30))
        r = analyse(french, None, stand_in, THRESHOLD)
        self.assertEqual((r.status, r.reason), ("unavailable", "unsupported_language"))

    def test_windows_under_the_threshold_become_ai_segments_and_the_score_is_their_share_of_words(self):
        text = essay(60, marker=lambda i: i < 12)  # the first window, 168 words, reads as machine-written
        r = analyse(text, None, stand_in, THRESHOLD)
        self.assertEqual(r.status, "done")
        self.assertEqual(r.qualifying_words, 840)
        (seg,) = r.segments
        self.assertEqual((seg["start"], seg["label"], seg["p"]), (0, "ai", 0.5))
        self.assertEqual(text[seg["end"] - 1], ".")
        self.assertEqual(r.score, 20.0)

    def test_human_text_scores_zero_with_no_segments(self):
        r = analyse(essay(30), None, stand_in, THRESHOLD)
        self.assertEqual((r.status, r.score, r.segments), ("done", 0.0, []))

    def test_the_scorer_sees_only_prose(self):
        seen = []
        analyse("- a robotic list line that should never be scored at all.\n" + essay(30), None,
                lambda texts: seen.extend(texts) or [1.0] * len(texts), THRESHOLD)
        self.assertFalse(any("list line" in t for t in seen))


if __name__ == "__main__":
    unittest.main()

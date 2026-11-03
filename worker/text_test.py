import unittest

from text import bibliography_start, in_quote, normalize, quote_spans, words


class NormalizeTest(unittest.TestCase):
    def test_folds_compatibility_characters(self):
        self.assertEqual(normalize("ﬁne ＡＢＣ"), "fine ABC")

    def test_strips_zero_width_characters(self):
        self.assertEqual(normalize("co​ral re‍ef﻿s⁠"), "coral reefs")

    def test_turns_browser_line_breaks_into_newlines(self):
        # Browsers submit <textarea> line breaks as CRLF; offsets and paragraphs assume \n.
        self.assertEqual(normalize("one\r\ntwo\rthree"), "one\ntwo\nthree")


class WordsTest(unittest.TestCase):
    def test_gives_character_offsets_of_each_word(self):
        text = "Coral reefs, mostly."
        self.assertEqual([text[a:b] for a, b in words(text)], ["Coral", "reefs", "mostly"])
        self.assertEqual(words(text)[1], (6, 11))

    def test_keeps_accented_words_whole(self):
        self.assertEqual(len(words("café naïve")), 2)

    def test_has_no_words_in_punctuation_and_space(self):
        self.assertEqual(words(" -- , ! \n"), [])


def quoted(text):
    return [text[a:b] for a, b in quote_spans(text)]


class QuoteSpansTest(unittest.TestCase):
    def test_finds_straight_and_curly_double_quotes(self):
        text = 'She wrote "the sea is rising" and then “we must act” in her notes.'
        self.assertEqual(quoted(text), ['"the sea is rising"', "“we must act”"])

    def test_never_pairs_across_a_missing_closing_quote(self):
        text = 'He said "nothing more that day. Later she wrote "a full line" here.'
        self.assertEqual(quoted(text), ['"a full line"'])

    def test_ignores_single_quotes(self):
        self.assertEqual(quote_spans("It's what the 'experts' call it."), [])

    def test_skips_a_quote_over_1200_characters_or_across_a_blank_line(self):
        self.assertEqual(quote_spans('"' + "word " * 300 + '"'), [])
        self.assertEqual(quote_spans('"first paragraph\n\nsecond paragraph"'), [])
        self.assertEqual(quoted('"one line\nwrapped by a PDF"'), ['"one line\nwrapped by a PDF"'])


class InQuoteTest(unittest.TestCase):
    def test_counts_a_match_at_least_half_inside_quotes(self):
        spans = [(10, 20), (30, 40)]
        self.assertTrue(in_quote(10, 20, spans))
        self.assertTrue(in_quote(15, 25, spans))
        self.assertTrue(in_quote(15, 35, spans), "inside two spans, 10 of 20 characters")
        self.assertFalse(in_quote(16, 26, spans))
        self.assertFalse(in_quote(0, 10, []))


class BibliographyStartTest(unittest.TestCase):
    BODY = "The essay itself goes on for a while about the coast.\n" * 10

    def test_finds_the_reference_list_heading_near_the_end(self):
        text = self.BODY + "References\nSmith, J. (2020). Tides. Sea Press.\n"
        self.assertEqual(bibliography_start(text), len(self.BODY))

    def test_accepts_the_other_headings_in_any_case_with_a_number_or_colon(self):
        for heading in ["WORKS CITED", "Bibliography:", "7. Literature cited", "  Sources  ",
                        "IX. References", "IX. REFERENCES", "VII References"]:  # IEEE numbers sections in Roman
            text = self.BODY + heading + "\nSmith, J. (2020). Tides.\n"
            self.assertEqual(bibliography_start(text), len(self.BODY), heading)

    def test_takes_the_last_heading(self):
        text = self.BODY + "References\nSmith.\n" + "References\nJones.\n"
        self.assertEqual(bibliography_start(text), len(self.BODY) + len("References\nSmith.\n"))

    def test_ignores_a_heading_in_the_first_60_percent_or_inside_a_sentence(self):
        self.assertIsNone(bibliography_start("Sources\n" + self.BODY))
        self.assertIsNone(bibliography_start(self.BODY + "References to the tide appear in many old songs.\n"))
        self.assertIsNone(bibliography_start(""))


if __name__ == "__main__":
    unittest.main()

import unittest

from align import align
from text import words

# An original paragraph (written for these tests), standing in for text copied from a web page.
PARAGRAPH = ("Mangrove forests grow along tropical coastlines where salt water meets fresh water. "
             "Their tangled roots slow the tide, trap sediment and shelter young fish, crabs and shrimp. "
             "When storms arrive, a wide belt of mangroves can absorb much of the energy of the waves "
             "before they reach the shore.")


def same_words(a, b):
    return [w.casefold() for w in _words(a)] == [w.casefold() for w in _words(b)]


def _words(text):
    return [text[x:y] for x, y in words(text)]


class AlignTest(unittest.TestCase):
    def test_finds_a_pasted_paragraph_as_one_span(self):
        draft = "I started my essay with my own opening line. " + PARAGRAPH + " Then I wrote a conclusion of my own."
        source = "Coastal habitats | Nature notes\nHome > Habitats\n" + PARAGRAPH + "\nShare this page. Related articles."

        matches = align(draft, source)

        self.assertEqual(len(matches), 1)
        m = matches[0]
        self.assertEqual(m.word_count, len(words(PARAGRAPH)))
        self.assertEqual(draft[m.doc_start:m.doc_end], PARAGRAPH[:-1])  # the span ends at the last word
        self.assertTrue(same_words(draft[m.doc_start:m.doc_end], source[m.src_start:m.src_end]))
        first_word = len(words("I started my essay with my own opening line."))
        self.assertEqual(m.doc_words, (first_word, first_word + m.word_count))

    def test_a_shared_run_of_7_words_is_not_reported(self):
        draft = "alpha bravo charlie one two three four five six seven delta echo foxtrot"
        source = "golf hotel one two three four five six seven india juliet kilo"
        self.assertEqual(align(draft, source), [])

    def test_a_shared_run_of_8_words_is_reported(self):
        draft = "alpha bravo charlie one two three four five six seven eight delta echo foxtrot"
        source = "golf hotel one two three four five six seven eight india juliet kilo"
        matches = align(draft, source)
        self.assertEqual([m.word_count for m in matches], [8])
        self.assertEqual(draft[matches[0].doc_start:matches[0].doc_end], "one two three four five six seven eight")

    def test_case_and_punctuation_changes_still_match(self):
        draft = "Their tangled roots slow the tide, trap sediment and shelter young fish."
        source = "THEIR TANGLED ROOTS -- slow the tide; trap sediment, and shelter young fish!"
        self.assertEqual([m.word_count for m in align(draft, source)], [len(words(draft))])

    def test_unrelated_texts_do_not_match(self):
        self.assertEqual(align(PARAGRAPH, "A completely different text about volcanoes, lava and ash clouds rising."), [])

    def test_a_phrase_repeated_in_the_source_gives_one_match_per_draft_passage(self):
        phrase = "the energy of the waves before they reach the shore"
        matches = align("Notes: " + phrase + ".", phrase + ". Again: " + phrase + ".")
        self.assertEqual(len(matches), 1)

    def test_every_shared_run_of_8_or_more_words_is_found(self):
        # The winnowing guarantee, on random texts: a small vocabulary makes repeats and near-misses common.
        import random
        rng = random.Random(20261029)
        vocab = [f"w{i}" for i in range(40)]
        for _ in range(300):
            run = [rng.choice(vocab) for _ in range(rng.randint(8, 20))]
            draft = [rng.choice(vocab) for _ in range(rng.randint(0, 60))]
            source = [rng.choice(vocab) for _ in range(rng.randint(0, 60))]
            at_d, at_s = rng.randint(0, len(draft)), rng.randint(0, len(source))
            draft[at_d:at_d] = run
            source[at_s:at_s] = run
            matches = align(" ".join(draft), " ".join(source))
            covering = [m for m in matches if m.doc_words[0] <= at_d and at_d + len(run) <= m.doc_words[1]]
            self.assertTrue(covering, f"missed a {len(run)}-word run at {at_d}")

    def test_short_or_empty_texts_are_fine(self):
        self.assertEqual(align("", PARAGRAPH), [])
        self.assertEqual(align("too short", "too short"), [])


if __name__ == "__main__":
    unittest.main()

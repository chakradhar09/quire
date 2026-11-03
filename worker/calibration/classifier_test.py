"""The classifier's text handling and metrics, and the LLM judge's reply parser. No model, no network."""
import unittest

from calibration.classifier_data import _paragraphs, cut, in_test, ocr_broken, subject
from calibration.judge_ai import parse
from calibration.train_classifier import auroc
from classifier import plain

NAN = float("nan")


class PlainTest(unittest.TestCase):
    def test_typography_is_folded(self):
        self.assertEqual(plain("“It’s—well…” a ‐ b – c d"), "\"It's-well...\" a - b - c d")

    def test_markdown_goes(self):
        self.assertEqual(plain("## Aim\n**Apparatus:** a `cavity` and __lamp black__."), "Aim\nApparatus: a cavity and lamp black.")

    def test_latex_flattens_like_a_word_equation(self):
        self.assertEqual(plain(r"$E = h\nu$ and $\frac{1}{2} m v_{max}^2$"), "E = hν and 12 m vmax2")
        self.assertEqual(plain(r"\(\lambda_{max} T = 2.898 \times 10^{-3}\,\text{m K}\)"), "λmax T = 2.898 ×10-3 m K")
        self.assertEqual(plain(r"$$\Delta x \cdot \Delta p \geq \frac{\hbar}{2}$$"), "Δx ⋅Δp ≥ħ2")

    def test_plain_text_is_unchanged(self):
        self.assertEqual(plain("It's a \"plain\" - text..."), "It's a \"plain\" - text...")


class CutTest(unittest.TestCase):
    def test_hard_wrapped_lines_join_and_windows_are_plain(self):
        text = "This sentence was wrapped\nby the source and keeps going with “many” words here. " * 30
        ws = cut(text)
        self.assertTrue(ws)
        self.assertTrue(all("\n" not in w and "“" not in w for w in ws))
        self.assertTrue(all(len(w.split()) >= 40 for w in ws))

    def test_paragraphs_survive_and_short_texts_give_nothing(self):
        self.assertEqual(cut("Too short."), [])
        self.assertTrue(cut(("One paragraph of a dozen plain words that goes on a while. " * 10 + "\n\n") * 3))

    def test_split_is_stable(self):
        self.assertEqual(in_test("some title"), in_test("some title"))
        share = sum(in_test(f"t{i}") for i in range(2000)) / 2000
        self.assertTrue(0.1 < share < 0.2, share)


class LegalTextTest(unittest.TestCase):
    def test_ocr_spacing_is_caught_and_clean_prose_is_not(self):
        self.assertTrue(ocr_broken("S ev eral crim inal sta tu tes m ay be app licab le to im p ro p e r d isc lo su re " * 20))
        self.assertFalse(ocr_broken("The commission reviewed the record and found that the agency had exceeded "
                                    "its authority under the statute. " * 20))

    def test_subject_is_the_title_or_the_first_real_sentence(self):
        self.assertEqual(subject("Social Security Primer", "anything"), "Social Security Primer")
        letter = "DEPARTMENT OF HEALTH\nOffice of the Secretary\n\nYour State will be participating this year in the review of improper payments made under the program. More text."
        self.assertTrue(subject(None, letter).startswith("Your State will be participating"))
        self.assertIsNone(subject(None, "Short.\nLines."))

    def test_govreport_sections_flatten_in_order(self):
        tree = {"paragraphs": ["a"], "subsections": [{"paragraphs": ["b", "c"], "subsections": [{"paragraphs": ["d"]}]}]}
        self.assertEqual(list(_paragraphs([tree, {"paragraphs": ["e"]}])), ["a", "b", "c", "d", "e"])


class AurocTest(unittest.TestCase):
    def test_extremes_ties_and_nan(self):
        self.assertEqual(auroc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1.0)
        self.assertEqual(auroc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0.0)
        self.assertEqual(auroc([0.5, 0.5], [0, 1]), 0.5)
        self.assertEqual(auroc([0.1, NAN, 0.9], [0, 1, 1]), 1.0)  # a NaN once looped it forever


class JudgeParseTest(unittest.TestCase):
    def test_reply_in_a_code_fence(self):
        self.assertEqual(parse('```json\n{"1": 15, "2": 80, "9": 5}\n```', 8), {1: 15.0, 2: 80.0})

    def test_junk_and_out_of_range(self):
        self.assertEqual(parse("no json here", 3), {})
        self.assertEqual(parse('{"1": 150, "x": 3, "2": "40"}', 3), {2: 40.0})


if __name__ == "__main__":
    unittest.main()

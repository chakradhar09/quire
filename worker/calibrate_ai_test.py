"""Calibration maths and report with a stand-in scorer: no model, no data download."""
import pathlib
import tempfile
import unittest

import docx

from calibrate_ai import calibrate, read_folder, report, threshold_for


def essay(n, word="describes"):
    return " ".join(f"Sentence {i} {word} how the river shapes the lives of people beside it today." for i in range(n))


def stand_in(texts):
    """Human text scores 1.0 and up, 'robotic' text 0.6; one odd human essay ('quirky') scores 0.7."""
    return [0.6 if "robotic" in t else 0.7 if "quirky" in t else 1.0 + 0.001 * len(t) % 0.3 for t in texts]


class ThresholdTest(unittest.TestCase):
    def test_at_most_one_percent_of_human_windows_fall_under_it(self):
        scores = [0.5, 0.6] + [1.0 + i / 1000 for i in range(198)]  # 200 windows: 2 odd ones, 1% may fall under
        threshold, rate = threshold_for(scores, max_rate=0.01)
        self.assertEqual(threshold, 1.0, "the highest bar that keeps it to 1%, so it catches the most AI text")
        self.assertEqual(sum(s < threshold for s in scores), 2)
        self.assertEqual(rate, 0.01)

    def test_with_few_windows_nothing_human_is_flagged(self):
        threshold, rate = threshold_for([0.9, 1.1, 1.0], max_rate=0.01)
        self.assertEqual((threshold, rate), (0.9, 0.0))

    def test_ties_never_push_the_rate_over(self):
        scores = [0.8] * 5 + [1.0] * 95
        threshold, rate = threshold_for(scores, max_rate=0.01)
        self.assertLessEqual(rate, 0.01)


class CalibrateTest(unittest.TestCase):
    def setUp(self):
        self.human = {f"h{i}": essay(30) for i in range(20)}
        self.human["odd"] = essay(30, "quirky")
        self.ai = {"a1": essay(30, "robotic"), "a2": essay(30, "robotic"), "short": essay(10, "robotic")}
        self.result = calibrate(self.human, self.ai, stand_in, max_rate=0.01)

    def test_counts_windows_and_essays_on_both_sides(self):
        r = self.result
        self.assertEqual((r["human_essays"], r["ai_essays"]), (21, 3))
        self.assertEqual(r["human_windows"], 21 * 3)
        self.assertEqual(r["ai_windows"], 3 + 3 + 1)

    def test_sets_the_threshold_from_human_windows_and_measures_the_ai_ones_against_it(self):
        r = self.result
        self.assertEqual(r["threshold"], 0.7, "63 human windows: none may fall under, so the odd essay sets the bar")
        self.assertEqual(r["false_positive_rate"], 0.0)
        self.assertEqual(r["ai_windows_caught"], 7)
        self.assertEqual(r["ai_essays_flagged"], 2, "whole essays scoring 20% or more; the short one gets no estimate")
        self.assertEqual(r["ai_essays_scored"], 2)
        self.assertEqual(r["human_essays_flagged"], [])

    def test_the_report_credits_persuade_and_gives_the_env_lines(self):
        text = report(self.result, human_source="PERSUADE 2.0 sample")
        self.assertIn("PERSUADE 2.0", text)
        self.assertIn("CC BY 4.0", text)
        self.assertIn("AI_THRESHOLD=0.7", text)
        self.assertIn("AI_FALSE_POSITIVE_RATE=0.0", text)
        self.assertIn("AI_DETECTION_RATE=1.0", text, "both long AI essays were flagged")


class ReadFolderTest(unittest.TestCase):
    def test_reads_every_supported_file_and_skips_the_rest(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            folder = pathlib.Path(tmp)
            (folder / "one.txt").write_bytes(b"Plain\r\ntext essay.")  # write_text would turn \n into \r\n again
            d = docx.Document()
            d.add_paragraph("A Word essay.")
            d.save(folder / "two.docx")
            (folder / "notes.md").write_text("ignored", encoding="utf-8")
            texts = read_folder(folder)
        self.assertEqual(texts, {"one.txt": "Plain\ntext essay.", "two.docx": "A Word essay."})


if __name__ == "__main__":
    unittest.main()

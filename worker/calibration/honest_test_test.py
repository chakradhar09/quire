"""The honest test's job plan. No model, no network."""
import unittest
from collections import Counter

from calibration.honest_test import GENRES, MODELS, STYLES, jobs


class JobsTest(unittest.TestCase):
    def test_every_topic_is_written_twice_by_every_model_slot(self):
        found = jobs()
        self.assertEqual(len(found), 2 * sum(len(topics) for _, topics in GENRES.values()))
        self.assertEqual(len({path for path, *_ in found}), len(found))
        self.assertEqual(set(Counter(m for _, m, _, _ in found)), set(MODELS))
        self.assertEqual({p.stem.rsplit("-", 1)[1] for p, *_ in found}, set(STYLES))

    def test_the_prompt_names_the_topic_and_asks_for_plain_text(self):
        path, _, prompt, _ = jobs()[0]
        self.assertIn(GENRES["patent"][1][0], prompt)
        self.assertIn("no Markdown", prompt)
        self.assertEqual(path.parent.name, "patent")


if __name__ == "__main__":
    unittest.main()

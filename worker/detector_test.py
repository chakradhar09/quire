"""Which AI detector the worker builds, and the classifier's settings and NaN guard. No model is loaded."""
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

import torch

import classifier
import main
from binoculars import Binoculars

CLEAR = {k: "" for k in ("AI_DETECTOR", "AI_CLASSIFIER", "AI_CLASSIFIER_THRESHOLD", "AI_CLASSIFIER_FALSE_POSITIVE_RATE",
                         "AI_CLASSIFIER_DETECTION_RATE", "AI_THRESHOLD")}


class DetectorChoiceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.model = pathlib.Path(self.dir.name)

    def choose(self, **env):
        with mock.patch.dict(os.environ, {**CLEAR, "AI_CLASSIFIER": str(self.model), **env}):
            return main.detector_from_env()

    def test_unset_uses_the_classifier_once_one_is_trained(self):
        self.assertIsInstance(self.choose(), Binoculars)
        (self.model / "config.json").write_text("{}")
        self.assertIsInstance(self.choose(), classifier.Classifier)

    def test_an_explicit_choice_wins(self):
        (self.model / "config.json").write_text("{}")
        self.assertIsInstance(self.choose(AI_DETECTOR="Binoculars"), Binoculars)
        self.assertIsInstance(self.choose(AI_DETECTOR="classifier"), classifier.Classifier)
        with self.assertRaises(ValueError):
            self.choose(AI_DETECTOR="gpt-judge")


class ClassifierSettingsTest(unittest.TestCase):
    def test_reads_its_own_calibration_not_binoculars(self):
        env = {**CLEAR, "AI_THRESHOLD": "0.8773", "AI_CLASSIFIER_THRESHOLD": "0.1172",
               "AI_CLASSIFIER_FALSE_POSITIVE_RATE": "0.01", "AI_CLASSIFIER_DETECTION_RATE": "0.611"}
        with mock.patch.dict(os.environ, env):
            d = json.loads(classifier.Classifier().describe())
        self.assertEqual((d["detector"], d["threshold"], d["calibrated"]), ("classifier", 0.1172, True))
        self.assertEqual((d["falsePositiveRate"], d["detectionRate"]), (0.01, 0.611))

    def test_uncalibrated_without_its_threshold(self):
        with mock.patch.dict(os.environ, {**CLEAR, "AI_THRESHOLD": "0.8773"}):
            self.assertFalse(json.loads(classifier.Classifier().describe())["calibrated"])


class FakeModel:
    """Logits that are NaN for the first `bad` calls, then say 'AI' with probability 0.75."""

    def __init__(self, bad):
        self.bad = bad

    def __call__(self, **enc):
        n = enc["input_ids"].shape[0]
        self.bad -= 1
        logits = torch.full((n, 2), float("nan")) if self.bad >= 0 else torch.tensor([[0.0, 1.0986123]] * n)
        return type("Out", (), {"logits": logits})()


class NanGuardTest(unittest.TestCase):
    def scorer(self, bad):
        c = classifier.Classifier(threshold=0.5)
        c.torch, c.mode, c.model = torch, "cpu", FakeModel(bad)
        c.tokenizer = lambda texts, **kw: type("Enc", (dict,), {"to": lambda self, d: self})(
            input_ids=torch.zeros((len(texts), 4), dtype=torch.long))
        return c

    def test_one_nan_batch_is_scored_again(self):
        self.assertAlmostEqual(self.scorer(1)(["a", "b"])[0], 0.25, places=4)

    def test_nan_twice_is_refused_not_read_as_human(self):
        with self.assertRaises(RuntimeError):
            self.scorer(2)(["a"])


if __name__ == "__main__":
    unittest.main()


class BraveKeyTest(unittest.TestCase):
    """The similarity check's key: the Settings page's data/settings.json wins, else the environment."""

    def test_environment_then_settings_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = pathlib.Path(tmp) / "settings.json"
            with mock.patch.dict(os.environ, {"BRAVE_API_KEY": ""}):
                self.assertEqual(main.brave_key(settings), "")  # no file yet
                settings.write_text(json.dumps({"autoUpdate": False, "braveApiKey": " BSAfromsettings "}), encoding="utf-8")
                self.assertEqual(main.brave_key(settings), "BSAfromsettings")
                settings.write_text("{ not json", encoding="utf-8")
                self.assertEqual(main.brave_key(settings), "")
            with mock.patch.dict(os.environ, {"BRAVE_API_KEY": "BSAfromenv"}):
                self.assertEqual(main.brave_key(settings), "BSAfromenv")  # the file is unreadable, so the env counts
                settings.write_text(json.dumps({"braveApiKey": "BSAfromsettings"}), encoding="utf-8")
                self.assertEqual(main.brave_key(settings), "BSAfromsettings")

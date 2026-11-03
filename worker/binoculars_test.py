"""Opt-in: loads the real models (about 6 GB), so plain test runs skip it. From worker/:

    AI_SMOKE=1 AI_SMOKE_HUMAN=<a .txt of human writing> python -m unittest binoculars_test -v

The machine-written side is the performer's own greedy answer to an essay prompt, so it is
certainly model text. Human text has to come from a file: nothing written here would count.
"""
import os
import pathlib
import time
import unittest

from ai import prose_sentences, windows


@unittest.skipUnless(os.environ.get("AI_SMOKE") == "1", "loads the real models: set AI_SMOKE=1")
class BinocularsSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from binoculars import Binoculars
        cls.b = Binoculars()
        cls.b([])  # nothing to score: models stay unloaded
        assert cls.b.models is None
        cls.b._load()

    def generate(self, prompt):
        b = self.b
        performer = b.models[1]
        if b.mode == "swap":
            performer.to("cuda")
        try:
            enc = b.tokenizer.apply_chat_template([{"role": "user", "content": prompt}], add_generation_prompt=True,
                                                  return_tensors="pt", return_dict=True).to(b.gpu)
            out = performer.generate(**enc, max_new_tokens=260, do_sample=False)
            return b.tokenizer.decode(out[0, enc["input_ids"].shape[1]:], skip_special_tokens=True)
        finally:
            if b.mode == "swap":
                performer.to("cpu")

    def test_model_written_text_scores_lower_than_human_text(self):
        human_file = os.environ.get("AI_SMOKE_HUMAN")
        if not human_file:
            self.skipTest("set AI_SMOKE_HUMAN to a .txt of human writing")
        ai_text = self.generate("Write a 180-word paragraph for a school essay on why rivers matter to cities.")
        human = pathlib.Path(human_file).read_text(encoding="utf-8")
        human_window = " ".join(human[a:b] for a, b, _ in windows(prose_sentences(human))[0])
        ai_score, human_score = self.b([ai_text, human_window])
        print(f"\n  mode {self.b.mode}: model text {ai_score:.4f}, human text {human_score:.4f}")
        self.assertLess(ai_score, human_score)

    def test_time_per_1000_words(self):
        human_file = os.environ.get("AI_SMOKE_HUMAN")
        text = pathlib.Path(human_file).read_text(encoding="utf-8") if human_file else self.generate(
            "Write a 600-word school essay on why rivers matter to cities.")
        groups = windows(prose_sentences(text))
        n = sum(c for g in groups for *_, c in g)
        texts = [" ".join(text[a:b] for a, b, _ in g) for g in groups]
        start = time.perf_counter()
        scores = self.b(texts)
        seconds = time.perf_counter() - start
        print(f"\n  mode {self.b.mode}: {len(texts)} windows, {n} words in {seconds:.1f} s"
              f" = {1000 * seconds / max(n, 1):.1f} s per 1,000 words; scores {[round(s, 3) for s in scores]}")
        self.assertEqual(len(scores), len(texts))


if __name__ == "__main__":
    unittest.main()

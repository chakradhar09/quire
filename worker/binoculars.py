"""Binoculars (Hans et al., 2024): log-perplexity of a text under the performer model divided by
the cross-perplexity between observer and performer. Lower means more machine-like.

Settings (worker/.env):
    AI_OBSERVER   base model, default Qwen/Qwen2.5-1.5B
    AI_PERFORMER  its instruct model (same tokenizer), default Qwen/Qwen2.5-1.5B-Instruct
    AI_DEVICE     cuda or cpu, default cuda when available
    AI_THRESHOLD  windows scoring under it count as AI-written; set by calibrate_ai.py (T13)
    AI_FALSE_POSITIVE_RATE  what calibration measured on human essays, shown on S14
    AI_DETECTION_RATE       the share of AI test essays it flagged, shown on S14

Models are loaded on the first window that needs scoring, once per worker run. When both fit in
free video memory they stay there; otherwise each sits in RAM and visits the GPU in turn, which
is slower per draft but needs room for only one. Nothing leaves this PC.
"""
import json
import os

UNCALIBRATED_THRESHOLD = 0.9  # ponytail: a guess until calibrate_ai.py measures one on real essays
MAX_TOKENS = 512              # a ~160-word window is ~220 tokens; longer windows are cut here
HEADROOM = 1.5e9              # bytes of video memory left for activations and logits


class Binoculars:
    def __init__(self, observer=None, performer=None, device=None, threshold=None, false_positive_rate=None):
        self.observer_name = observer or os.environ.get("AI_OBSERVER") or "Qwen/Qwen2.5-1.5B"
        self.performer_name = performer or os.environ.get("AI_PERFORMER") or "Qwen/Qwen2.5-1.5B-Instruct"
        self.device = device or os.environ.get("AI_DEVICE") or None
        configured = threshold if threshold is not None else os.environ.get("AI_THRESHOLD")
        self.calibrated = configured not in (None, "")
        self.threshold = float(configured) if self.calibrated else UNCALIBRATED_THRESHOLD
        rate = false_positive_rate if false_positive_rate is not None else os.environ.get("AI_FALSE_POSITIVE_RATE")
        self.false_positive_rate = float(rate) if rate not in (None, "") else None
        caught = os.environ.get("AI_DETECTION_RATE")
        self.detection_rate = float(caught) if caught else None
        self.models = None
        self.mode = None  # "gpu" (both resident), "swap" (one at a time), "cpu"

    def describe(self):
        """What ai_reports.model records, read by S14."""
        d = {"detector": "binoculars", "observer": self.observer_name, "performer": self.performer_name,
             "threshold": self.threshold, "calibrated": self.calibrated, "mode": self.mode}
        if self.false_positive_rate is not None:
            d["falsePositiveRate"] = self.false_positive_rate
        if self.detection_rate is not None:
            d["detectionRate"] = self.detection_rate
        return json.dumps(d)

    def _load(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        device = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        self.tokenizer = AutoTokenizer.from_pretrained(self.performer_name)
        models = [AutoModelForCausalLM.from_pretrained(name, dtype=dtype).eval()
                  for name in (self.observer_name, self.performer_name)]
        if device == "cuda":
            need = sum(p.numel() * p.element_size() for m in models for p in m.parameters()) + HEADROOM
            self.mode = "gpu" if torch.cuda.mem_get_info()[0] > need else "swap"
            if self.mode == "gpu":
                models = [m.to("cuda") for m in models]
        else:
            self.mode = "cpu"
        self.torch, self.gpu, self.models = torch, device, models

    def _score(self, ids, observer_probs, performer_logits):
        torch = self.torch
        perf = performer_logits.float()
        log_ppl = torch.nn.functional.cross_entropy(perf, ids[0, 1:])
        x_ppl = -(observer_probs.float() * torch.log_softmax(perf, -1)).sum(-1).mean()
        return (log_ppl / x_ppl).item()

    def __call__(self, texts):
        if not texts:
            return []
        if self.models is None:
            self._load()
        torch = self.torch
        observer, performer = self.models
        batch = [self.tokenizer(t, return_tensors="pt", truncation=True, max_length=MAX_TOKENS).input_ids.to(self.gpu)
                 for t in texts]
        with torch.inference_mode():
            if self.mode != "swap":  # both resident: one window at a time, nothing kept
                return [self._score(ids, torch.softmax(observer(ids).logits[0, :-1].float(), -1),
                                    performer(ids).logits[0, :-1]) for ids in batch]
            # One model on the GPU at a time: keep the observer's next-token probabilities in RAM (bf16,
            # ~70 MB a window), then score each window once the performer is on the GPU.
            observer.to("cuda")
            probs = [torch.softmax(observer(ids).logits[0, :-1].float(), -1).to("cpu", torch.bfloat16) for ids in batch]
            observer.to("cpu")
            torch.cuda.empty_cache()
            performer.to("cuda")
            try:
                return [self._score(ids, p.to("cuda"), performer(ids).logits[0, :-1]) for ids, p in zip(batch, probs)]
            finally:
                performer.to("cpu")
                torch.cuda.empty_cache()

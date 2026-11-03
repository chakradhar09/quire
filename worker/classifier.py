"""A fine-tuned ModernBERT that reads a window and gives the chance it was AI-written; trained by
calibration/train_classifier.py on public human/AI essays and abstracts plus current models' essays.

It scores like Binoculars, lower meaning more machine-like (1 minus that chance), so ai.analyse and
calibrate_ai treat both the same. Settings (worker/.env):
    AI_CLASSIFIER  folder of the trained model, default data/calibration/classifier/model
    AI_CLASSIFIER_THRESHOLD, AI_CLASSIFIER_FALSE_POSITIVE_RATE, AI_CLASSIFIER_DETECTION_RATE
                   its own calibration (calibration/eval_classifier.py), kept apart from Binoculars' AI_THRESHOLD
                   so one worker/.env holds both and AI_DETECTOR can switch between them
    AI_DEVICE      as for Binoculars
Nothing leaves this PC.
"""
import json
import os
import pathlib
import re

from calibration import data_dir

MAX_TOKENS = 320  # a ~160-word window is ~220 tokens
BATCH = 32
# Word curls quotes as you type and models emit Unicode dashes, so typography says nothing about the author:
# fold it before training and scoring alike.
PLAIN = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "‟": '"',
                       "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
                       "…": "...", " ": " "})


# Models write Markdown and LaTeX; a Word draft has neither (pasted output arrives rendered) and its equations come
# out flattened: "E=σT4", "λmax", "12mvmax2" for ½mv²max. So both fold to that form, or "has ** or $" would read as AI.
LATEX = {"nu": "ν", "lambda": "λ", "hbar": "ħ", "pi": "π", "Delta": "Δ", "delta": "δ", "psi": "ψ", "Psi": "Ψ",
         "phi": "φ", "Phi": "Φ", "varphi": "φ", "theta": "θ", "omega": "ω", "Omega": "Ω", "alpha": "α", "beta": "β",
         "gamma": "γ", "mu": "μ", "sigma": "σ", "epsilon": "ε", "varepsilon": "ε", "rho": "ρ", "tau": "τ", "eta": "η",
         "kappa": "κ", "chi": "χ", "infty": "∞", "times": "×", "cdot": "⋅", "approx": "≈", "leq": "≤", "le": "≤",
         "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠", "pm": "±", "to": "→", "rightarrow": "→", "Rightarrow": "⇒",
         "implies": "⇒", "propto": "∝", "partial": "∂", "nabla": "∇", "int": "∫", "sum": "Σ", "sqrt": "√",
         "circ": "∘", "degree": "°", "angstrom": "Å", "AA": "Å"}
LATEX_DROP = {"left", "right", "quad", "qquad", "displaystyle", "big", "Big", "bigg", "Bigg", "limits", "mathrm",
              "mathbf", "mathit", "text", "textbf", "textit", "operatorname", "boxed", "frac", "dfrac", "tfrac", "it", "bf"}


def _latex(t):
    t = re.sub(r"\\[,;:! ]|\\\\", " ", t)
    # The space after a command only ends its name; unknown commands (\sin, \log) keep their name.
    t = re.sub(r"\\([A-Za-z]+) ?", lambda m: LATEX.get(m.group(1), "" if m.group(1) in LATEX_DROP else m.group(1)), t)
    t = re.sub(r"\$\$|\$|\\\(|\\\)|\\\[|\\\]", "", t)
    return re.sub(r"[{}^_]", "", t)  # \frac{1}{2}, v_{max}^2 -> 12, vmax2, as Word flattens them


def plain(text):
    t = text.translate(PLAIN)
    t = re.sub(r"\*\*|__|`", "", t)
    t = re.sub(r"(?m)^#{1,6}[ \t]+", "", t)
    return _latex(t) if "\\" in t or "$" in t else t


def trained(path=None):
    """Whether a trained model is where Classifier would look for it."""
    return (pathlib.Path(path or os.environ.get("AI_CLASSIFIER") or data_dir() / "classifier" / "model") / "config.json").exists()


class Classifier:
    def __init__(self, path=None, device=None, threshold=None):
        self.path = path or os.environ.get("AI_CLASSIFIER") or str(data_dir() / "classifier" / "model")
        self.device = device or os.environ.get("AI_DEVICE") or None
        configured = threshold if threshold is not None else os.environ.get("AI_CLASSIFIER_THRESHOLD")
        self.calibrated = configured not in (None, "")
        self.threshold = float(configured) if self.calibrated else 0.5
        rate = os.environ.get("AI_CLASSIFIER_FALSE_POSITIVE_RATE")
        caught = os.environ.get("AI_CLASSIFIER_DETECTION_RATE")
        self.false_positive_rate = float(rate) if rate else None
        self.detection_rate = float(caught) if caught else None
        self.model = None
        self.mode = None

    def describe(self):
        d = {"detector": "classifier", "model": "ModernBERT-base, fine-tuned", "threshold": self.threshold,
             "calibrated": self.calibrated, "mode": self.mode}
        if self.false_positive_rate is not None:
            d["falsePositiveRate"] = self.false_positive_rate
        if self.detection_rate is not None:
            d["detectionRate"] = self.detection_rate
        return json.dumps(d)

    def _load(self):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        if not trained(self.path):  # otherwise transformers reads the path as a Hugging Face repo name
            raise FileNotFoundError(f"no trained classifier in {self.path}: run calibration/train_classifier.py, "
                                    "set AI_CLASSIFIER, or set AI_DETECTOR=binoculars")
        self.mode = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = AutoTokenizer.from_pretrained(self.path)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            self.path, dtype=torch.bfloat16 if self.mode == "cuda" else torch.float32).to(self.mode).eval()
        self.torch = torch

    def __call__(self, texts):
        if not texts:
            return []
        if self.model is None:
            self._load()
        out = []
        with self.torch.inference_mode():
            for i in range(0, len(texts), BATCH):
                enc = self.tokenizer([plain(t) for t in texts[i:i + BATCH]], truncation=True, max_length=MAX_TOKENS, padding=True,
                                     return_tensors="pt").to(self.mode)
                # This laptop GPU has now and then returned NaN for a batch that scores fine a second time; a NaN
                # would read as "not AI" (NaN < threshold is false), so try again, then refuse.
                for _ in range(2):
                    p_ai = self.torch.softmax(self.model(**enc).logits.float(), -1)[:, 1]
                    if self.torch.isfinite(p_ai).all():
                        break
                else:
                    raise RuntimeError("the classifier returned NaN twice for the same windows")
                out += (1 - p_ai).tolist()
        return out

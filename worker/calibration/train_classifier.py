"""Fine-tune ModernBERT-base on the windows calibration.classifier_data wrote, on this PC's GPU.

    python -m calibration.train_classifier [--epochs 1] [--out data/calibration/classifier/model]      from worker/

Base model: answerdotai/ModernBERT-base (Apache-2.0, 601 MB, from the Hugging Face cache). Prints
validation AUROC as it goes and saves the model and tokenizer for classifier.Classifier.
"""
import argparse
import json
import random
import time

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from calibration.classifier_data import root
from classifier import MAX_TOKENS, plain

BASE = "answerdotai/ModernBERT-base"
BATCH = 16
LR = 2e-5


def read(name):
    return [json.loads(line) for line in (root() / f"{name}.jsonl").open(encoding="utf-8")]


def auroc(scores, labels):
    """Chance a random AI window gets a higher AI score than a random human one (ties count half)."""
    pairs = sorted((s, l) for s, l in zip(scores, labels) if s == s)  # drops NaN, which never equals itself
    labels = [l for _, l in pairs]
    rank_sum, n_pos, i = 0.0, sum(labels), 0
    while i < len(pairs):
        j = i + 1
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            j += 1
        rank_sum += (i + j + 1) / 2 * sum(l for _, l in pairs[i:j])
        i = j
    n_neg = len(labels) - n_pos
    return (rank_sum - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg) if n_pos and n_neg else float("nan")


def p_ai(model, tok, texts):
    out = []
    model.eval()
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        for i in range(0, len(texts), 64):
            enc = tok(texts[i:i + 64], truncation=True, max_length=MAX_TOKENS, padding=True, return_tensors="pt").to("cuda")
            out += torch.softmax(model(**enc).logits.float(), -1)[:, 1].tolist()
    model.train()
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--epochs", type=float, default=1)
    parser.add_argument("--out", default=str(root() / "model"))
    args = parser.parse_args()

    train, val = read("train"), read("val")
    random.Random(0).shuffle(train)
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(BASE, num_labels=2, attn_implementation="eager").to("cuda")
    steps = int(len(train) * args.epochs / BATCH)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    sched = get_linear_schedule_with_warmup(opt, steps // 20, steps)
    print(f"{len(train)} train, {len(val)} val windows; {steps} steps", flush=True)
    start = time.perf_counter()
    skipped = 0
    model.train()
    for step in range(steps):
        batch = [train[(step * BATCH + k) % len(train)] for k in range(BATCH)]
        enc = tok([plain(r["text"]) for r in batch], truncation=True, max_length=MAX_TOKENS, padding=True, return_tensors="pt").to("cuda")
        with torch.autocast("cuda", dtype=torch.bfloat16):
            loss = model(**enc, labels=torch.tensor([r["label"] for r in batch], device="cuda")).loss
        loss.backward()
        # A non-finite gradient would turn every weight into NaN (it did, in bf16 with fused attention): skip the step.
        if torch.isfinite(torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)):
            opt.step()
        else:
            skipped += 1
        sched.step()
        opt.zero_grad()
        if (step + 1) % 200 == 0 or step + 1 == steps:
            msg = f"  step {step + 1}/{steps} loss {loss.item():.3f} {time.perf_counter() - start:.0f} s, {skipped} skipped"
            if (step + 1) % 1000 == 0 or step + 1 == steps:
                msg += f" val AUROC {auroc(p_ai(model, tok, [r['text'] for r in val]), [r['label'] for r in val]):.4f}"
            print(msg, flush=True)
    model.save_pretrained(args.out)
    tok.save_pretrained(args.out)
    print(f"saved to {args.out}")


if __name__ == "__main__":
    main()

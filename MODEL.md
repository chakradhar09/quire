# Quire's AI-writing classifier

The model behind Quire's AI-writing estimate: what it is, what it was trained on, how well it works, and what it may be used for. The training and evaluation code is in [`worker/calibration/`](worker/calibration/); the full history of each version is in [`tasks/plan.md`](tasks/plan.md).

## What it is

- **Model:** [ModernBERT-base](https://huggingface.co/answerdotai/ModernBERT-base) (Apache-2.0), fine-tuned as a two-class classifier: human-written or AI-written.
- **Input:** a window of about 160 words of prose (consecutive sentences of six or more words, outside lists, tables and the reference list), after folding typography (curly quotes, dashes) and flattening Markdown and LaTeX the way Word renders them.
- **Output:** a score per window; a window under the threshold counts as AI-written. A draft's percentage is the share of its prose words inside such windows. Under 300 words of prose, or under 20%, Quire shows no number rather than guess.
- **Version shipped:** v5, threshold **0.2028**, set so 1.0% of 6,678 human-written windows from the held-out sets fall under it.
- **Download:** `quire-classifier-v5.zip` from the [`model-v5` release](https://github.com/chakradhar09/quire/releases/tag/model-v5) (about 575 MB); the installer fetches it into `data/calibration/classifier/model`.

## Training data

About 59,000 windows. Each source keeps its own test split, never trained on.

| Source | Kind | Licence |
|---|---|---|
| PERSUADE 2.0 | US school students' essays (human) | CC BY 4.0 |
| Ghostbuster | essays, human and AI | CC BY 3.0 |
| ArguGPT | argumentative essays by models (AI) | CC |
| RAID (no attacks) | abstracts, Wikipedia, news, books, Reddit, reviews; human and AI | MIT |
| IDMGSP | scientific papers, real and generated | OpenRAIL++ |
| Pile of Law (11 subsets) | legal and government documents before 2022 (human) | **CC BY-NC-SA 4.0** |
| GovReport (CRS, GAO) | government reports (human) | CC BY 4.0 |
| OpenStax, Physics Stack Exchange | STEM explanations (human) | CC BY 4.0, CC BY-SA 4.0 |
| unarXive | computer-science paper paragraphs before 2022 (human) | CC BY-SA 4.0 |
| Generated for this project | essays, abstracts, legal and STEM texts by current models on NVIDIA's API; research papers by Claude | outputs of those models |

No draft checked with Quire is ever used for training, and no draft was sent to any model to produce the generated texts: their prompts used only public titles, prompts and topics invented for the purpose.

## How well it works

All numbers at the shipped threshold, on text the model never trained on. A **window** is about 160 words.

**Human writing flagged as AI (lower is better)**

| Set | Windows flagged |
|---|---|
| Student essays (PERSUADE calibration set) | 0.8% |
| CS papers before 2022 (unarXive test) | 0.7% |
| Scientific papers (IDMGSP test) | 1.0% |
| Legal and government documents (test splits) | 0 to 3% |
| Legal decisions from sources never trained on (NLRB, SEC, immigration appeals, FTC) | 0 to 0.6% |
| Research papers by non-native English writers (PubMed Central) | 5.4% |
| Wikipedia before 2022 | 2.5% |
| US patents before 2019 (BigPatent test) | 4.5%; 5 of 150 patents scored 20% or more |

**AI writing caught (higher is better)**

| Set | Windows flagged |
|---|---|
| Essays by models never trained on (Nemotron, Step-5) | 89 to 100% |
| Law papers, patents and CS papers by Nemotron models, on new topics | 94%, 76%, 98% (43 of 43 papers scored 20% or more) |
| 2026 models in TextSight's benchmark | 76% |
| Raw text from GPT, Claude, Gemini, DeepSeek and Grok (WasItAIGenerated, Sept 2026) | 40 to 60% |
| The same models' text run through commercial humanizers | 0 to 30% |

**What this means.** It is good at catching model families close to its training data and at leaving ordinary student and academic writing alone. It is much weaker on the newest models it never saw and on text deliberately rewritten to evade detection, and it flags writing by non-native English speakers more often. A score is a reason to reread a passage, not a verdict.

## Intended use

- **For:** writers checking their own drafts before submission.
- **Not for:** deciding whether someone else cheated, grading, discipline or any decision about a person. The error rates above make that unfair, and they are higher for some groups of writers.

## Next version

v6 (trained, not shipped) adds human patents, papers across many fields and the training half of WasItAIGenerated's 2026 benchmark. It catches far more of the 2026 models' text (59 to 91% of raw passages) and stops flagging patents (0 of 150), but flags 16% of old public-domain literature, against 0.2% for v5. It ships once that is fixed.

## Licence

The model weights are released under **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**: free to use and share for non-commercial purposes, with attribution, under the same licence. This follows the most restrictive licence among its training data (the Pile of Law subsets); the use restrictions of IDMGSP's OpenRAIL++ licence (no harmful or deceptive uses) apply as well. This is the project's reading of those licences, not legal advice. Quire's code is separately licensed under AGPL-3.0.

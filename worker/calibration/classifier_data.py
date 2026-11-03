"""Training windows for the AI-writing classifier, from the public sets in data/calibration/classifier/raw/
and the essays calibration.generate_nvidia wrote.

    python -m calibration.classifier_data      from worker/

Every text is cut the way drafts are (ai.windows over prose sentences), so the classifier learns on
~160-word windows like the ones it will score. What is kept apart for testing never reaches train.jsonl:
the 300 PERSUADE calibration essays, the essays in data/calibration/ai/, the held-out models' essays,
the RAID titles listed under "test" in titles.json, and each set's own test split.

Sources (downloaded by hand, see tasks/plan.md): PERSUADE 2.0 (CC BY 4.0), Ghostbuster essays (CC BY 3.0),
ArguGPT machine essays (CC), RAID abstracts without attacks (MIT), IDMGSP papers (OpenRAIL++), and formal
legal and government prose from before 2022: eleven Pile of Law subsets (CC BY-NC-SA 4.0, so this model is
not for commercial use) and GovReport's CRS and GAO reports (CC BY 4.0); OpenStax and Physics SE; unarXive's CS
paper paragraphs from before 2022 (CC BY-SA 4.0). IDMGSP's zips name their files ../../../../../../train.csv, so they are read in memory and never extracted.
"""
import ast
import csv
import hashlib
import io
import json
import lzma
import random
import re
import zipfile

from ai import prose_sentences, windows
from classifier import plain
from calibration import data_dir, persuade
from text import normalize

MIN_WINDOW_WORDS = 40
PER_DOC = 3  # windows kept from one long document, so a few papers don't outweigh everything else
GENERATED_REPEAT = 3  # current models are the ones that matter, and there are few of their essays
RAID_MODELS = {"chatgpt", "gpt4", "gpt3", "cohere-chat", "llama-chat", "mistral-chat", "mpt-chat"}
OTHER_GENRES = ("wiki", "news", "books", "reddit", "reviews")
GHOSTBUSTER_HUMAN = 6  # label names: claude, gpt, gpt_prompt1, gpt_prompt2, gpt_semantic, gpt_writing, human
# Formal legal and government prose (v3 flagged a 2017 law review article at 36%). File stem: what it is,
# which generate_nvidia's prompts reuse.
PILE_OF_LAW = {
    "train.olc_memos": "memorandum opinion from the U.S. Justice Department's Office of Legal Counsel",
    "validation.acus_reports": "research report for the Administrative Conference of the United States",
    "train.cc_casebooks": "chapter of a law school casebook",
    "validation.echr": "judgment of the European Court of Human Rights",
    "validation.hhs_alj": "decision by a U.S. Department of Health and Human Services administrative law judge",
    "validation.fmshrc": "decision of the Federal Mine Safety and Health Review Commission",
    "validation.irs_legal_advice_memos": "IRS Office of Chief Counsel legal advice memorandum",
    "train.doj_guidance": "U.S. Justice Department guidance document",
    "train.federal_register": "Federal Register notice or rule",
    "validation.ed_policy_guidance": "U.S. Department of Education policy guidance letter",
    "validation.medicaid_policy_guidance": "CMS Medicaid policy guidance letter",
}
GOVREPORT = {"crs_valid": "Congressional Research Service report", "gao_valid": "U.S. Government Accountability Office report"}
LEGAL = {**PILE_OF_LAW, **GOVREPORT}
LEGAL_PER_SOURCE = 300
SHARED_URL = {"validation.echr", "train.cc_casebooks"}
# STEM explanations (v3 scored a model-written physics assignment 0%): OpenStax's STEM textbooks (CC BY 4.0) and
# Physics Stack Exchange answers (CC BY-SA 4.0) to questions numbered below ~680,000, which is before 2022.
STEM_BOOK = re.compile(r"Physics|Chemistry|Calculus|Algebra|Precalculus|Statistics|Astronomy|Biology|Microbiology|"
                       r"Anatomy|Mathematics")
PHYSICS_SE_BEFORE = 680000
STEM_PER_SOURCE = 1500
# Research papers (v4 scored Claude-written IEEE papers 0-3%): unarXive's IMRaD paragraphs from CS papers (CC BY-SA
# 4.0; each paper CC BY, BY-SA or CC0) on arXiv before 2022, against papers Claude sessions wrote for this.
UNARXIVE_BEFORE = "2201"
# Windows kept per document where PER_DOC would waste most of a long paper.
PER_DOC_BY_SOURCE = {"unarxive": 8, "generated-papers": 60, "generated-patents": 20}
PAPERS_REPEAT = 2
# Patents (v5 falsely flagged 5 of 150 pre-2019 patents in the honest test): BigPatent descriptions (CC BY 4.0,
# US patents to 2018) from its train split, against specifications generate_nvidia's training models wrote for
# inventions named by other train-split abstracts. The honest test's patents come from the test split.
PATENTS_HUMAN = 800
WASITAI_TEST = 0.5

csv.field_size_limit(2**31 - 1)


def root():
    return data_dir() / "classifier"


def cut(text):
    """The draft-style windows of a text, after joining lines a source hard-wrapped and folding typography."""
    t = plain(normalize(re.sub(r"(?<!\n)\n(?!\n)", " ", text or "")))
    found = [" ".join(t[a:b] for a, b, _ in g) for g in windows(prose_sentences(t))]
    return [w for w in found if len(w.split()) >= MIN_WINDOW_WORDS]


def in_test(key, share=0.15):
    return int(hashlib.sha1(key.encode("utf-8")).hexdigest(), 16) % 1000 < share * 1000


def raid(domains=("abstracts",)):
    """RAID rows as (domain, title, model, text), human and the chat or GPT generators, no repetition penalty."""
    with (root() / "raw/raid/train_none.csv").open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["domain"] in domains and (row["model"] == "human" or
                                             (row["model"] in RAID_MODELS and row["repetition_penalty"] != "yes")):
                yield row["domain"], row["title"], row["model"], row["generation"]


def raid_abstracts():
    """RAID abstracts as (title, model, text)."""
    return ((t, m, g) for _, t, m, g in raid())


def idmgsp(split):
    """IDMGSP papers as (src, text): abstract, introduction and conclusion."""
    with zipfile.ZipFile(root() / "raw/idmgsp/classifier_input.zip") as z:
        name = next(n for n in z.namelist() if n.endswith(f"{split}.csv"))
        with z.open(name) as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")):
                yield row["src"], "\n\n".join(row[k] for k in ("abstract", "introduction", "conclusion") if row[k])


def _paragraphs(node):
    """Every paragraph of a GovReport section tree, in order."""
    if isinstance(node, list):
        for n in node:
            yield from _paragraphs(n)
    elif isinstance(node, dict):
        yield from node.get("paragraphs") or []
        yield from _paragraphs(node.get("subsections") or [])


def ocr_broken(text, limit=0.30):
    """Scanned memos and decisions often read "S ev eral crim inal sta tu tes": over 30% of words of one or two
    letters (clean English is ~20%). Training on them would teach "garbled = human", not the register."""
    found = re.findall(r"[A-Za-z]+", text[:6000])
    return sum(len(w) <= 2 for w in found) > limit * max(1, len(found))


def legal():
    """Legal and government documents from before 2022 as (source, key, title or None, text). Undated Pile of
    Law documents are kept: the set was collected by January 2023, before model-written text was common."""
    for stem in PILE_OF_LAW:
        with lzma.open(root() / f"raw/pileoflaw/{stem}.jsonl.xz", "rt", encoding="utf-8") as f:
            for i, line in enumerate(f):
                r = json.loads(line)
                year = re.search(r"(19|20)\d\d", str(r.get("created_timestamp") or ""))
                if not (year and int(year.group(0)) >= 2022) and not ocr_broken(r["text"]):
                    title, text = None, r["text"]
                    if text.startswith("ITEMID:"):  # ECHR: KEY: value lines, then TEXT: the judgment
                        head, _, text = text.partition("\nTEXT: ")
                        title = next((l[9:] for l in head.splitlines() if l.startswith("DOCNAME: ")), None)
                    # ECHR's and the casebooks' documents all carry one url, which would put every one on one side
                    url = r.get("url") or ""
                    yield stem, f"{stem}:{url}#{i}" if stem in SHARED_URL else f"{stem}:{url or i}", title, text
    for stem in GOVREPORT:
        with (root() / f"raw/govreport/{stem}.jsonl").open(encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                body = r.get("reports") or r.get("report")
                if (r.get("released_date") or "")[:4] < "2022":
                    yield stem, f"{stem}:{r['id']}", r["title"], "\n\n".join(
                        _paragraphs(ast.literal_eval(body) if isinstance(body, str) else body))


def stem():
    """Human STEM explanations as (source, key, text): OpenStax sections and Physics Stack Exchange answers."""
    for book in map(json.loads, (root() / "raw/openstax/openstax_books.jsonl").open(encoding="utf-8")):
        if book["language"] != "en" or not STEM_BOOK.search(book["book_title"]):
            continue
        stack = [book["chapters"]]
        while stack:  # chapters nest in units at some depth; the text is in {title, paragraph} nodes
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if node.get("paragraph") and "OpenStax" not in node["paragraph"]:
                    yield "openstax", f"openstax:{book['book_title']}:{node.get('title')}", node["paragraph"]
                stack.extend(v for v in node.values() if isinstance(v, (list, dict)))
    for f in sorted((root() / "raw/physics_se").glob("*.jsonl")):
        for q in map(json.loads, f.open(encoding="utf-8")):
            qid = re.search(r"/questions/(\d+)/", q["url"])
            if qid and int(qid.group(1)) < PHYSICS_SE_BEFORE:
                for i, (answer, _) in enumerate(q["answers"] or []):
                    yield "physics_se", f"physics_se:{qid.group(1)}:{i}", answer


def unarxive():
    """Human CS papers from before 2022 as (key, text): each paper's paragraphs from unarXive's dev and test files,
    in order, with its "[3]}" citation marks made "[3]"."""
    paper = {}
    for r in map(json.loads, (root() / "raw/unarxive/license_info.jsonl").open(encoding="utf-8")):
        if re.fullmatch(r"\d{4}\.\d{4,5}", r["paper_arxiv_id"]) and r["paper_arxiv_id"][:4] < UNARXIVE_BEFORE:
            for i, s in enumerate(r["sample_ids"]):
                paper[s] = (r["paper_arxiv_id"], i)
    found = {}
    for name in ("dev.jsonl", "test.jsonl"):
        for r in map(json.loads, (root() / f"raw/unarxive/{name}").open(encoding="utf-8")):
            if r["_id"] in paper:
                pid, i = paper[r["_id"]]
                found.setdefault(pid, []).append((i, re.sub(r"\]\}", "]", r["text"]).strip()))
    for pid, parts in sorted(found.items()):
        yield f"unarxive:{pid}", "\n\n".join(t for _, t in sorted(parts))


def subject(title, text, words=50):
    """What generate_nvidia's prompt names: the title, or else the first real prose sentence (not letterhead)."""
    if title:
        return title
    t = normalize(re.sub(r"(?<!\n)\n(?!\n)", " ", text[:8000]))
    first = next((t[a:b] for a, b, n in prose_sentences(t) if n >= 12), None)
    return " ".join(first.split()[:words]) if first else None


def bigpatent(split, n, span, seed=19):
    """n (description, abstract) pairs from BigPatent's `split`, 50 rows from each of n/50 random offsets below
    `span`, fetched once through Hugging Face's dataset viewer and cached in raw/bigpatent/{split}.jsonl.
    Paragraph numbers ([0012]) are dropped."""
    cache = root() / "raw" / "bigpatent" / f"{split}.jsonl"
    if not cache.exists():
        import time
        import httpx
        rows, client = [], httpx.Client(timeout=120)
        for offset in random.Random(seed).sample(range(0, span, 100), n // 50):
            r = client.get("https://datasets-server.huggingface.co/rows", params={
                "dataset": "NortheasternUniversity/big_patent", "config": "all", "split": split,
                "offset": offset, "length": 50})
            r.raise_for_status()
            rows += [{"text": x["row"]["description"], "abstract": x["row"]["abstract"]} for x in r.json()["rows"]]
            time.sleep(1)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    rows = [json.loads(line) for line in cache.open(encoding="utf-8")]
    return [(re.sub(r"\[\d{4}\]", "", r["text"]), r.get("abstract", "")) for r in rows]


def wasitai():
    """English rows with text of the WasItAIGenerated benchmark (September 2026; licence per row, all allowing reuse):
    (id, label, group, generator, text). Current models (GPT-6, Claude Opus 5.5, Gemini 3.8, Grok 4.7, DeepSeek V4 ...)
    raw, paraphrased and run through six commercial humanizers, against student essays, learner English, speeches and
    documentation. Half goes to training and half (in_test with WASITAI_TEST) to the honest test."""
    import pyarrow.parquet as pq
    for r in pq.read_table(root() / "raw/wasitai/benchmark.parquet").to_pylist():
        # Labels: human, ai, humanized (AI through a humanizer: still AI), ai_edited (left out: part human).
        if r["lang"] == "en" and r["text"] and r["label"] != "ai_edited":
            yield r["id"], int(r["label"] != "human"), r["group"], r["generator"], r["text"]


def documents(rng):
    """(source, label, text) of every training document; label 1 is AI."""
    import pyarrow.parquet as pq

    held = {e["id"] for e in persuade.sample(n=300)}
    with (data_dir() / persuade.ESSAYS).open(encoding="utf-8", newline="") as f:
        essays = [e for e in csv.DictReader(f) if e["id"] not in held]
    for e in rng.sample(essays, 3000):
        yield "persuade", 0, e["text"]

    gb = pq.read_table(root() / "raw/ghostbuster/train.parquet").to_pylist()
    human = [r for r in gb if r["label"] == GHOSTBUSTER_HUMAN]
    for r in human:
        yield "ghostbuster", 0, r["text"]
    for r in rng.sample([r for r in gb if r["label"] != GHOSTBUSTER_HUMAN], 2000):
        yield "ghostbuster", 1, r["text"]

    for name in ("machine-train.csv", "machine-dev.csv"):
        with (root() / "raw/argugpt" / name).open(encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        for r in rng.sample(rows, min(len(rows), 1500 if "train" in name else 200)):
            yield "argugpt", 1, r["text"]

    abstracts = [a for a in raid_abstracts() if not in_test(a[0])]
    for _, model, text in [a for a in abstracts if a[1] == "human"]:
        yield "raid", 0, text
    for _, model, text in rng.sample([a for a in abstracts if a[1] != "human"], 3000):
        yield "raid", 1, text

    # Other genres, so that "encyclopedic" or "news" doesn't become a sign of AI.
    rows = [r for r in raid(OTHER_GENRES) if not in_test(r[1])]
    for domain in OTHER_GENRES:
        human = [r for r in rows if r[0] == domain and r[2] == "human"]
        for _, _, _, text in rng.sample(human, min(len(human), 800)):
            yield f"raid-{domain}", 0, text
        for _, _, _, text in rng.sample([r for r in rows if r[0] == domain and r[2] != "human"], 800):
            yield f"raid-{domain}", 1, text

    papers = list(idmgsp("train"))
    for _, text in rng.sample([p for p in papers if p[0] == "real"], 2000):
        yield "idmgsp", 0, text
    for _, text in rng.sample([p for p in papers if p[0] in ("chatgpt", "galactica")], 2000):
        yield "idmgsp", 1, text

    by_source = {}
    for source, key, _, text in legal():
        if not in_test(key):
            by_source.setdefault(source, []).append(text)
    for source, texts in by_source.items():
        for text in rng.sample(texts, min(len(texts), LEGAL_PER_SOURCE)):
            yield f"legal-{source.split('.')[-1]}", 0, text

    by_source = {}
    for source, key, text in stem():
        if not in_test(key):
            by_source.setdefault(source, []).append(text)
    for source, texts in by_source.items():
        for text in rng.sample(texts, min(len(texts), STEM_PER_SOURCE)):
            yield f"stem-{source}", 0, text

    for key, text in unarxive():
        if not in_test(key):
            yield "unarxive", 0, text

    for text, _ in bigpatent("train", PATENTS_HUMAN, 1_000_000):
        yield "bigpatent", 0, text

    for key, label, _, _, text in wasitai():
        if not in_test(key, WASITAI_TEST):  # once each: AI rows outnumber human ones 3 to 1 already
            yield "wasitai", label, text

    for p in sorted((root() / "generated/train").glob("*/*.txt")):
        if p.parent.name == "patents":  # few and short, against 800 human patents
            for _ in range(GENERATED_REPEAT):
                yield "generated-patents", 1, p.read_text(encoding="utf-8")
        elif p.parent.name in ("papers", "fields"):  # whole papers: many windows each
            for _ in range(PAPERS_REPEAT):
                yield "generated-papers", 1, p.read_text(encoding="utf-8")
        else:
            for _ in range(GENERATED_REPEAT):
                yield "generated", 1, p.read_text(encoding="utf-8")


def write_titles():
    """RAID's human abstract titles and the legal documents' subjects, split into train and test, for
    generate_nvidia's abstracts and legal documents."""
    titles = sorted({t for t, model, _ in raid_abstracts() if model == "human"})
    split = {"train": [t for t in titles if not in_test(t)], "test": [t for t in titles if in_test(t)], "legal": {"train": [], "test": []}}
    for source, key, title, text in legal():
        about = subject(title, text)
        if about:
            split["legal"]["test" if in_test(key) else "train"].append([source, about])
    (root() / "titles.json").write_text(json.dumps(split, indent=1), encoding="utf-8")
    return split


def build(seed=2026, log=print):
    rng = random.Random(seed)
    rows = []
    for doc, (source, label, text) in enumerate(documents(rng)):
        ws, keep = cut(text), PER_DOC_BY_SOURCE.get(source, PER_DOC)
        for w in (rng.sample(ws, keep) if len(ws) > keep else ws):
            rows.append({"text": w, "label": label, "source": source, "doc": doc})
    rng.shuffle(rows)
    val_docs = {r["doc"] for r in rows if in_test(f"doc{r['doc']}", 0.05)}
    for name, part in (("train", [r for r in rows if r["doc"] not in val_docs]), ("val", [r for r in rows if r["doc"] in val_docs])):
        with (root() / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            f.writelines(json.dumps(r) + "\n" for r in part)
        counts = {}
        for r in part:
            counts[(r["source"], r["label"])] = counts.get((r["source"], r["label"]), 0) + 1
        log(f"{name}: {len(part)} windows " + ", ".join(f"{s}/{'ai' if l else 'human'} {n}" for (s, l), n in sorted(counts.items())))


if __name__ == "__main__":
    import sys
    if "--titles" in sys.argv:
        s = write_titles()
        print(f"titles: {len(s['train'])} train, {len(s['test'])} test; legal subjects: "
              f"{len(s['legal']['train'])} train, {len(s['legal']['test'])} test")
    else:
        build()

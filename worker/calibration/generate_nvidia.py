"""AI essays and abstracts from current models on NVIDIA's free API, for training and testing the classifier.

    python -m calibration.generate_nvidia [--kind essays|abstracts|legal|stem|patents]      from worker/

Essays answer the 15 PERSUADE prompts in three styles; abstracts answer paper titles taken from
RAID's human abstracts; legal documents take the type and subject of a pre-2022 legal or government
document (calibration.classifier_data writes both to titles.json); STEM answers take the questions in STEM,
written for this. It sends only those
prompts and titles, never a draft. Files land in data/calibration/classifier/generated/{train,test}/,
the test side being models the classifier never trains on. Already-written files are skipped, so a
stopped run carries on.
"""
import argparse
import json
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor

import httpx2

from calibration import data_dir
from calibration.generate_ai import PROMPTS, prompt_text, slug

API = "https://integrate.api.nvidia.com/v1/chat/completions"
TRAIN_MODELS = ["minimaxai/minimax-m3.1-flash", "mistralai/mistral-large-4-1t-a52b", "openai/gpt-oss-20b",
                "meta/muse-glimmer-30b", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "google/gemma-4-31b-it"]
# The ones that answered in the essay runs (DeepSeek, GLM and Gemma mostly timed out), for later kinds.
RELIABLE_MODELS = TRAIN_MODELS[:4]
# Held out: every NVIDIA model (Nemotron-3-Ultra also wrote the calibration essays) and StepFun's.
TEST_MODELS = ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3.5-lightning-30b-a3b", "stepfun-ai/step-5-preview"]
WORKERS = 8  # 12 drew 429s once two runs shared the key; an essay takes ~3 min, a legal document longer
TRIES = 2
RETRY_WAIT = 30
TITLES = "titles.json"

STYLES = {
    "student": lambda spec, grade: prompt_text(spec, grade),
    "plain": lambda spec, grade: "Write an essay for this assignment.\n\n" + spec["assignment"].strip(),
    "casual": lambda spec, grade: prompt_text(spec, grade) + "\n\nWrite it the way a real student your age would, not too polished.",
}


# STEM assignment answers (v3 scored a model-written quantum mechanics assignment 0%). Written for this, not taken
# from any draft. (course, style, question); the last STEM_TEST go to the held-out models only.
STEM = [
    ("Engineering Physics", "answer", "Explain the failure of classical physics in explaining blackbody radiation and how Planck's hypothesis resolved it."),
    ("Engineering Physics", "answer", "Derive the time-independent Schrödinger wave equation and state the physical meaning of the wave function."),
    ("Engineering Physics", "answer", "State Heisenberg's uncertainty principle and show that an electron cannot exist inside the nucleus."),
    ("Engineering Physics", "numerical", "Calculate the de Broglie wavelength of an electron accelerated through a potential difference of 150 V."),
    ("Engineering Physics", "lab", "Determine Planck's constant using LEDs of different colours."),
    ("Engineering Physics", "answer", "Explain the Compton effect and derive the expression for the Compton shift."),
    ("Engineering Physics", "numerical", "A particle is confined in a one-dimensional box of width 2 Å. Find the energies of its first three states."),
    ("Engineering Physics", "answer", "Explain the principle, construction and working of a He-Ne laser."),
    ("Engineering Physics", "lab", "Determine the wavelength of a laser using a diffraction grating."),
    ("Engineering Physics", "answer", "Distinguish between spontaneous and stimulated emission and derive the Einstein coefficients relation."),
    ("Engineering Physics", "answer", "Explain the formation of energy bands in solids and classify conductors, semiconductors and insulators."),
    ("Engineering Physics", "numerical", "Find the numerical aperture and acceptance angle of an optical fibre with core index 1.48 and cladding index 1.45."),
    ("Engineering Physics", "lab", "Determine the energy band gap of a semiconductor using a p-n junction diode."),
    ("Engineering Physics", "answer", "Explain Newton's rings and derive the expression for the diameter of the dark rings."),
    ("Engineering Physics", "lab", "Determine the radius of curvature of a plano-convex lens by Newton's rings."),
    ("Engineering Chemistry", "answer", "Explain the hardness of water, its types and the EDTA method of estimating it."),
    ("Engineering Chemistry", "numerical", "A water sample contains 162 mg/L Ca(HCO3)2 and 95 mg/L MgCl2. Calculate its temporary and permanent hardness."),
    ("Engineering Chemistry", "answer", "Explain the electrochemical theory of corrosion and two methods of preventing it."),
    ("Engineering Chemistry", "lab", "Estimate the strength of an HCl solution by conductometric titration with NaOH."),
    ("Engineering Chemistry", "answer", "Describe the construction and working of a lithium-ion battery."),
    ("Engineering Chemistry", "answer", "Explain the Nernst equation and its application to the electrode potential of a cell."),
    ("Engineering Chemistry", "numerical", "Calculate the EMF of a Daniell cell at 25 °C when [Zn2+] = 0.1 M and [Cu2+] = 1 M."),
    ("Engineering Chemistry", "lab", "Determine the viscosity of a lubricating oil using a Redwood viscometer."),
    ("Engineering Chemistry", "answer", "Explain the classification of polymers and the mechanism of addition polymerisation."),
    ("Engineering Mathematics", "answer", "Define eigenvalues and eigenvectors and find them for the matrix [[2, 1], [1, 2]]."),
    ("Engineering Mathematics", "numerical", "Solve the differential equation dy/dx + y tan x = sec x."),
    ("Engineering Mathematics", "answer", "State and prove Rolle's theorem and verify it for f(x) = x² - 5x + 6 on [2, 3]."),
    ("Engineering Mathematics", "numerical", "Find the Laplace transform of t sin at and use it to evaluate an integral."),
    ("Engineering Mathematics", "answer", "Explain the Fourier series of a periodic function and find it for f(x) = x on (-π, π)."),
    ("Engineering Mathematics", "numerical", "Use the Newton-Raphson method to find a root of x³ - 2x - 5 = 0 correct to three decimals."),
    ("Engineering Mathematics", "answer", "Explain the method of Lagrange multipliers and find the maximum of xy subject to x + y = 10."),
    ("Basic Electrical Engineering", "answer", "State and explain Kirchhoff's laws with an example circuit."),
    ("Basic Electrical Engineering", "numerical", "A series RLC circuit has R = 10 Ω, L = 0.1 H and C = 100 μF on a 230 V, 50 Hz supply. Find the current and power factor."),
    ("Basic Electrical Engineering", "answer", "Explain the construction and working principle of a single-phase transformer and derive its EMF equation."),
    ("Basic Electrical Engineering", "lab", "Verify Thevenin's theorem for a given DC network."),
    ("Basic Electrical Engineering", "answer", "Explain the working of a three-phase induction motor and the meaning of slip."),
    ("Basic Electrical Engineering", "numerical", "Find the current in each branch of a circuit using mesh analysis for two meshes sharing a 4 Ω resistor."),
    ("Basic Electrical Engineering", "lab", "Determine the efficiency and regulation of a single-phase transformer by open- and short-circuit tests."),
    ("Engineering Mechanics", "answer", "State Lami's theorem and explain the conditions of equilibrium of a rigid body."),
    ("Engineering Mechanics", "numerical", "A ladder 5 m long rests against a smooth wall at 60° to the floor. Find the minimum coefficient of friction at the floor."),
    ("Engineering Mechanics", "answer", "Explain the work-energy principle and the law of conservation of momentum with examples."),
    ("Engineering Mechanics", "lab", "Determine the coefficient of static friction between two surfaces using an inclined plane."),
    ("Thermodynamics", "answer", "State the first and second laws of thermodynamics and explain the Carnot cycle."),
    ("Thermodynamics", "numerical", "A Carnot engine works between 500 K and 300 K and absorbs 1000 J per cycle. Find its efficiency and the work done."),
    ("Strength of Materials", "answer", "Explain stress, strain and Hooke's law, and draw the stress-strain curve for mild steel."),
    # Held out: only TEST_MODELS answer these.
    ("Engineering Physics", "answer", "Explain the photoelectric effect and Einstein's photoelectric equation."),
    ("Engineering Physics", "numerical", "The work function of sodium is 2.3 eV. Find the threshold wavelength and the maximum kinetic energy for 400 nm light."),
    ("Engineering Physics", "lab", "Determine the numerical aperture of an optical fibre."),
    ("Engineering Physics", "answer", "Explain the Davisson-Germer experiment and how it confirmed matter waves."),
    ("Engineering Physics", "answer", "Explain superconductivity, the Meissner effect and type I and type II superconductors."),
    ("Engineering Chemistry", "answer", "Explain the zeolite process of water softening with its advantages."),
    ("Engineering Chemistry", "lab", "Estimate the amount of ferrous iron by potentiometric titration."),
    ("Engineering Chemistry", "numerical", "Calculate the gross and net calorific values of a coal sample containing 84% C, 4% H and 2% moisture."),
    ("Engineering Mathematics", "answer", "Explain the Cayley-Hamilton theorem and use it to find the inverse of a 2 × 2 matrix."),
    ("Engineering Mathematics", "numerical", "Evaluate the double integral of xy over the region bounded by y = x and y = x²."),
    ("Basic Electrical Engineering", "answer", "Explain the working of a DC generator and derive its EMF equation."),
    ("Basic Electrical Engineering", "lab", "Verify the superposition theorem for a DC circuit."),
    ("Engineering Mechanics", "numerical", "A projectile is fired at 30 m/s at 40° to the horizontal. Find its range, maximum height and time of flight."),
    ("Thermodynamics", "answer", "Explain entropy and show that it increases in an irreversible process."),
    ("Strength of Materials", "numerical", "A steel rod 2 m long and 20 mm in diameter carries a tensile load of 50 kN. Find the stress, strain and elongation (E = 200 GPa)."),
]
STEM_TEST = 15
STEM_STYLES = {
    "answer": "Answer the way students write assignment answers: short definitions, points, derivation steps on separate lines, and a worked example where it fits.",
    "numerical": "Solve it the way students write numericals: Given, To find, Formula, Solution with each step on its own line, and the Answer with units.",
    "lab": "Write it as a lab record: Aim, Apparatus, Theory, Formula, Procedure, Observations, Calculation, Result, Precautions.",
}


PAPER_TYPES = ["a research paper", "a literature review", "a case study", "a term paper", "a report"]
FIELDS = {
    "medicine": ["antibiotic stewardship in rural hospitals", "telemedicine follow-up after heart surgery",
                 "vitamin D and respiratory infections", "managing type 2 diabetes in older adults",
                 "sepsis screening in emergency departments", "long-term effects of concussion in contact sports",
                 "the placebo effect in pain trials", "hand hygiene compliance among nurses"],
    "psychology": ["social media use and adolescent sleep", "the bystander effect in online spaces",
                   "cognitive behavioural therapy for insomnia", "memory reconsolidation and eyewitness testimony",
                   "burnout among medical residents", "growth mindset interventions in schools",
                   "loneliness in older adults living alone", "decision fatigue in judges"],
    "economics": ["minimum wage increases and small business employment", "inflation targeting in emerging markets",
                  "the gig economy and labour protections", "microfinance and women's entrepreneurship",
                  "carbon taxes versus cap-and-trade", "remittances and household investment",
                  "housing affordability and zoning rules", "the economics of free public transport"],
    "business management": ["remote work and team productivity", "supply chain resilience after the pandemic",
                            "employer branding in recruitment", "family business succession planning",
                            "customer loyalty programmes in retail", "agile adoption in large banks",
                            "corporate social responsibility reporting", "pricing strategy for subscription software"],
    "education": ["flipped classrooms in secondary mathematics", "formative assessment in primary schools",
                  "inclusive education for children with dyslexia", "teacher retention in rural schools",
                  "mother-tongue instruction in early grades", "online proctoring and academic integrity",
                  "project-based learning in engineering colleges", "homework and student achievement"],
    "sociology": ["urban migration and informal settlements", "caste and marriage in contemporary India",
                  "youth unemployment and political participation", "the digital divide among older people",
                  "gender roles in dual-income households", "religion and social cohesion in diverse cities",
                  "online communities and identity formation", "food insecurity among university students"],
    "political science": ["coalition governments and policy stability", "decentralisation and local service delivery",
                          "populism and the media", "electoral systems and minority representation",
                          "the role of regional organisations in conflict resolution", "lobbying and climate policy",
                          "e-governance and corruption", "voter turnout among young people"],
    "history": ["the partition of India and refugee resettlement", "the printing press and the Reformation",
                "the Marshall Plan and European recovery", "the Indian Ocean spice trade",
                "the Industrial Revolution and child labour", "the decolonisation of Africa",
                "the Green Revolution in Punjab", "the Cold War space race"],
    "English literature": ["the unreliable narrator in modern fiction", "postcolonial identity in Indian English novels",
                           "nature and the sublime in Romantic poetry", "the role of women in Victorian novels",
                           "magical realism in Latin American fiction", "Shakespeare's tragic heroes",
                           "dystopian fiction and surveillance", "memory and trauma in war literature"],
    "environmental science": ["microplastics in freshwater lakes", "urban heat islands and green roofs",
                              "groundwater depletion in agricultural regions", "mangrove restoration and coastal protection",
                              "air pollution from crop residue burning", "e-waste recycling in informal sectors",
                              "pollinator decline and crop yields", "invasive species in island ecosystems"],
    "civil engineering": ["self-healing concrete", "flood-resilient urban drainage design", "fly ash in road construction",
                          "seismic retrofitting of masonry buildings", "pavement design for heavy traffic",
                          "rainwater harvesting in high-rise buildings", "bridge health monitoring with sensors",
                          "construction waste recycling"],
    "mechanical engineering": ["heat exchanger design for waste heat recovery", "additive manufacturing of metal parts",
                               "vibration analysis of rotating shafts", "electric vehicle drivetrain efficiency",
                               "tribology of bio-based lubricants", "design of a low-cost prosthetic hand",
                               "solar water heaters for households", "fatigue failure in welded joints"],
    "biology": ["CRISPR gene editing in crops", "the gut microbiome and immunity", "antibiotic resistance genes in soil",
                "coral bleaching and symbiosis", "circadian rhythms in plants", "the evolution of venom",
                "stem cells in tissue repair", "biodiversity in urban parks"],
    "chemistry": ["green solvents in organic synthesis", "catalysts for hydrogen production",
                  "heavy metal removal with biochar", "lithium-sulphur battery chemistry", "biodegradable polymers",
                  "water purification with nanomaterials", "analytical methods for pesticide residues",
                  "corrosion inhibitors for steel"],
    "law": ["consumer protection in e-commerce", "the law of defamation on social media", "arbitration in construction disputes",
            "the legal status of live-in relationships", "environmental liability of polluting industries",
            "insider trading regulation", "legal aid and access to justice", "the regulation of cryptocurrency exchanges"],
    "public health": ["vaccine hesitancy in rural communities", "road traffic injuries among two-wheeler riders",
                      "tobacco control policies", "mental health services in primary care", "malnutrition in children under five",
                      "noise pollution and health", "heat waves and mortality", "community health workers and maternal care"],
}


def out_dir():
    return data_dir() / "classifier" / "generated"


def jobs(kind):
    """(path, model, prompt text, temperature) for every file this kind should have."""
    rng = random.Random(2026)
    found = []
    if kind == "essays":
        prompts = json.loads((data_dir() / PROMPTS).read_text(encoding="utf-8"))
        for side, models, styles in (("train", TRAIN_MODELS, list(STYLES)), ("test", TEST_MODELS, ["student", "plain"])):
            for model in models:
                for name in sorted(prompts):
                    for style in styles:
                        grade, temp = rng.randint(6, 12), rng.choice([0.6, 1.0])
                        found.append((out_dir() / side / "essays" / f"{slug(name)}-{slug(model)}-{style}.txt", model,
                                      STYLES[style](prompts[name], grade), temp))
    elif kind == "legal":
        from calibration.classifier_data import LEGAL
        subjects = json.loads((data_dir() / "classifier" / TITLES).read_text(encoding="utf-8"))["legal"]
        for side, models, n in (("train", RELIABLE_MODELS, 4), ("test", TEST_MODELS, 2)):
            for model in models:
                for source, what in LEGAL.items():
                    pool = [a for s, a in subjects[side] if s == source]
                    for about in rng.sample(pool, min(n, len(pool))):
                        name = f"{slug(source)}-{slug(about)[:40]}-{slug(model)}.txt"
                        found.append((out_dir() / side / "legal" / name, model,
                                      f"Write a {what} on the subject this opening introduces: \"{about}\"\n\n"
                                      "Write the whole document in your own words, in the register such documents use. "
                                      "Write only the document.", rng.choice([0.6, 1.0])))
    elif kind == "stem":
        for side, models, questions in (("train", RELIABLE_MODELS, STEM[:-STEM_TEST]), ("test", TEST_MODELS, STEM[-STEM_TEST:])):
            for model in models:
                for course, style, q in questions:
                    found.append((out_dir() / side / "stem" / f"{slug(q)[:60]}-{slug(model)}.txt", model,
                                  f"You are an engineering student answering this question from your {course} assignment. "
                                  f"{STEM_STYLES[style]} Write plain text as you would type it in Word: no Markdown and no "
                                  f"LaTeX; type symbols such as ν, λ, ħ, π, Δ, ×, √ and ° directly.\n\nQuestion: {q}",
                                  rng.choice([0.6, 1.0])))
    elif kind == "fields":
        # University papers across fields, training models only; every topic invented here, none from a draft or
        # from honest_test's list. Each topic by two models, in rotating paper types and levels.
        models = TRAIN_MODELS
        for f, (field, topics) in enumerate(FIELDS.items()):
            for i, topic in enumerate(topics):
                for j in range(2):
                    model = models[(i + 3 * j + f) % len(models)]
                    paper = PAPER_TYPES[(i + j + f) % len(PAPER_TYPES)]
                    level = ("an undergraduate", "a master's")[(i + f) % 2]
                    found.append((out_dir() / "train" / "fields" / f"{slug(field)}-{slug(topic)[:50]}-{slug(model)}.txt",
                                  model, f"Write {paper} of about 2,000 words for {level} course in {field} on {topic}. "
                                  "Use headings and cite sources in the style the field uses. Plain text as typed in "
                                  "Word, no Markdown. Write only the paper.", rng.choice([0.6, 1.0])))
    elif kind == "patents":
        # Inventions named by BigPatent train-split abstracts (public, pre-2019); training models only, as the
        # honest test holds out its own models and topics.
        from calibration.classifier_data import PATENTS_HUMAN, bigpatent
        about = [" ".join(a.split()[:40]) for _, a in bigpatent("train", PATENTS_HUMAN, 1_000_000) if a]
        for model in RELIABLE_MODELS:
            for a in rng.sample(about, 15):
                found.append((out_dir() / "train" / "patents" / f"{slug(a)[:50]}-{slug(model)}.txt", model,
                              f"Draft a US patent application for this invention: \"{a}\"\n\nInclude the title, technical "
                              "field, background, summary, description of the figures, detailed description and the "
                              "claims, in the language patent attorneys use. Plain text as typed in Word, no Markdown. "
                              "Write only the application.", rng.choice([0.6, 1.0])))
    else:
        titles = json.loads((data_dir() / "classifier" / TITLES).read_text(encoding="utf-8"))
        for side, models, n in (("train", TRAIN_MODELS, 30), ("test", TEST_MODELS, 15)):
            for model in models:
                for title in rng.sample(titles[side], n):
                    found.append((out_dir() / side / "abstracts" / f"{slug(title)[:60]}-{slug(model)}.txt", model,
                                  f"Write the abstract for a research paper titled \"{title}\". Write only the abstract.",
                                  rng.choice([0.6, 1.0])))
    return found


def one(job, key, client, log):
    path, model, prompt, temp = job
    for attempt in range(TRIES):
        if attempt:
            time.sleep(RETRY_WAIT)
        try:
            r = client.post(API, headers={"authorization": f"Bearer {key}"},
                            json={"model": model, "temperature": temp, "max_tokens": 16000,
                                  "messages": [{"role": "user", "content": prompt}]})
        except httpx2.HTTPError as e:
            log(f"  {path.name}: {type(e).__name__}")
            continue
        if r.status_code == 200:
            text = (r.json()["choices"][0]["message"].get("content") or "").strip()
            if text:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text + "\n", encoding="utf-8")
                return True
            log(f"  {path.name}: empty reply")
        else:
            log(f"  {path.name}: {r.status_code} {r.text[:120]}")
        if r.status_code == 404:  # the model was taken off the catalog
            return False
    return False


def answering(models, key, client, wait=90):
    """The models that reply to a one-line prompt within `wait` seconds. A model that has stopped answering
    otherwise holds a worker for TRIES x the timeout on every one of its jobs (once, three hours for 15 files)."""
    def ok(model):
        try:
            return client.post(API, headers={"authorization": f"Bearer {key}"}, timeout=wait, json={
                "model": model, "max_tokens": 200, "messages": [{"role": "user", "content": "Say OK."}]}).status_code == 200
        except httpx2.HTTPError:
            return False
    with ThreadPoolExecutor(len(models) or 1) as pool:
        return {m for m, alive in zip(models, pool.map(ok, models)) if alive}


def generate(kind, key, log=print, deadline=None):
    """Writes what is missing. With a deadline (time.time()), jobs not started by then are left for the next run."""
    todo = [j for j in jobs(kind) if not j[0].exists()]
    client = httpx2.Client(timeout=600)  # long legal documents need it; a busy model still times out eventually
    models = sorted({j[1] for j in todo})
    alive = answering(models, key, client)
    if set(models) - alive:
        log(f"  not answering now, skipped this run: {', '.join(sorted(set(models) - alive))}")
    todo = [j for j in todo if j[1] in alive]
    random.Random(0).shuffle(todo)  # mixes models, so one slow model doesn't hold every worker
    done = 0
    with ThreadPoolExecutor(WORKERS) as pool:
        for ok in pool.map(lambda j: (deadline is None or time.time() < deadline) and one(j, key, client, log), todo):
            done += ok
            if done % 20 == 0 and ok:
                log(f"  {done} of {len(todo)} written")
    return done, len(todo)


if __name__ == "__main__":
    import main
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--kind", choices=["essays", "abstracts", "legal", "stem", "patents", "fields"], default="essays")
    parser.add_argument("--minutes", type=float, help="keep going (retrying models that were not answering) this long")
    args = parser.parse_args()
    main.load_env(main.HERE / ".env")
    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        raise SystemExit("Put NVIDIA_API_KEY in worker/.env first.")
    deadline = time.time() + 60 * args.minutes if args.minutes else None
    while True:
        done, total = generate(args.kind, key, deadline=deadline)
        print(f"wrote {done} of {total}; run it again to retry the rest", flush=True)
        if deadline is None or time.time() > deadline or not any(not p.exists() for p, *_ in jobs(args.kind)):
            break
        time.sleep(120)  # models that were busy get another chance

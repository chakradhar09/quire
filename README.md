<p align="center"><img src="scripts/quire.png" alt="" width="96"></p>

<h1 align="center">Quire</h1>

<p align="center">Check your own drafts for matching sources and AI-like writing, on your own computer. Free and open source.</p>

---

Quire reads your paper the way a plagiarism checker would. It finds the sentences that match web pages and publications, ranks the sources, and estimates how much of the prose reads as AI-written. Then it gives you the flagged passages as a list to work through: quote and cite, rewrite, exclude or keep, one at a time, until nothing is left open.

It is for checking **your own** work before you hand it in, for students and writers who don't have access to a paid checker. There is no account and no server: everything runs on your PC except the web searches.

- **Similarity check.** Phrases from your draft are searched on the web (Brave Search). Pages sharing eight or more words in a row become sources, each with a colour, a rank and its share of your text. Open a match and see your sentence beside the source's.
- **AI-writing estimate.** A classifier on your PC scores each passage of prose and marks the ones that read as machine-written, with the model's measured error rates beside the number.
- **A report you work through.** Every flagged passage is a line on the list; handling it strikes it through instead of deleting it, so you can see what you decided and undo it.
- **Versions.** Upload a new draft of the same paper and Quire keeps them together, showing how the scores changed.
- **Files as they are.** Word, PDF, RTF, ODT or plain text, with equations, captions, text boxes, tables, the reference list and text in pictures (OCR) read in place.

## Read this before you rely on a number

**The AI-writing number is an estimate, not proof.** No detector is reliable enough to decide whether a person used AI, and Quire's is no exception. Measured on writing it never trained on:

| | Flagged as AI |
|---|---|
| Student essays written by people | about 1% of passages |
| Research papers by non-native English writers | 5% of passages |
| US patents written by people | 4.5% of passages; 3% of patents scored 20% or more |
| Raw text from GPT, Claude, Gemini, DeepSeek and Grok (2026 models) | 40 to 60% of passages |
| AI text passed through a "humanizer" | 0 to 30% of passages |

So a low score does not mean a person wrote it, and a high score does not mean they didn't. Use it to find passages worth a second look in your own writing, **never as evidence against someone else.** Details and every number: [MODEL.md](MODEL.md).

**The similarity check only sees the open web.** Paywalled journals, legal databases and other students' papers are invisible to it (commercial checkers license those). A low similarity score means no match on the public web, not that the text is original.

## Requirements

| | |
|---|---|
| **Computer** | Windows 10 or 11, macOS 12 or later, or a 64-bit Linux; 8 GB of RAM or more |
| **Disk space** | About 2 GB (4 GB with NVIDIA GPU support) |
| **Git** | Any recent version ([git-scm.com](https://git-scm.com/downloads)) |
| **Node.js** | **22.13 or later**. An older Node.js can stay; the installer offers to install a newer one if you don't have it. |
| **Python** | **3.11 or 3.12**, not 3.13 or later: one of Quire's packages (the OCR that reads text in pictures) has no build for them yet. Python 3.12 can sit beside a newer Python; the installer picks it, and offers to install it if you don't have it. |
| **Graphics card** | Optional. An NVIDIA GPU makes the AI estimate faster; Apple silicon Macs use theirs. Without one it runs on the processor, more slowly. |
| **Internet** | To install, for the similarity check's web searches, and to check for updates |
| **Brave Search API key** | For the similarity check; Brave asks for a card but gives about 100 checks' worth of free credit a month. See [Getting a Brave Search API key](#getting-a-brave-search-api-key). |

**The installer checks all of this for you.** If Git, Node.js or Python is missing or too old, it asks before installing it, with **winget** on Windows, **Homebrew** on macOS, or your package manager for Git on Linux (it asks for your password). Python and Node.js are covered everywhere: on Linux, or a Mac without Homebrew, it offers a private Python 3.12 and Node.js 22 kept inside Quire's own folder (no admin rights, nothing else on your computer changes, removed when you uninstall Quire). For anything else it can't install, it tells you exactly what to install, and you run it again afterwards.

## Install

**Windows:** open **PowerShell**, not Command Prompt: press Start, type *PowerShell*, and open **Windows PowerShell**. Paste this line and press Enter:

```powershell
irm https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/install.ps1 | iex
```

**macOS and Linux:** open **Terminal**, paste this line and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/install.sh | bash
```

`irm` (PowerShell's Invoke-RestMethod) and `curl` only download the installer script, which then runs. It installs into `%LOCALAPPDATA%\Quire` (Windows) or `~/.quire`, downloads the AI-writing model (about 560 MB), and adds Quire to the Start menu (Windows), or a `quire` command and a desktop entry (Linux and macOS). The whole install takes 5 to 15 minutes, mostly downloads.

The similarity check also needs a **Brave Search API key**, which you add once on Quire's **Settings** page: see [Getting a Brave Search API key](#getting-a-brave-search-api-key) below. Without one, Quire still gives the AI-writing estimate, and it tells you where to add the key.

**If the install doesn't work**

- *"irm is not recognized"* or *"'irm' is not recognized as an internal or external command"*: you are in Command Prompt. Open PowerShell instead (above).
- *"Quire still needs: ..."*: install what it lists (the line it prints shows how), open a **new** PowerShell or Terminal window so it is found, and run the installer again.
- *"curl: command not found"* (some Linux systems): install curl with your package manager, e.g. `sudo apt install curl`.
- *Python 3.13 or 3.14 is installed but Quire wants 3.12*: say yes when the installer offers Python 3.12; both can stay, and Quire uses 3.12.
- *"can't create virtual environments"* (Debian, Ubuntu): your Python lacks its `venv` part. Say yes to the private Python 3.12, or install the package it names (e.g. `sudo apt install python3.12-venv`) and run the installer again.
- *It stops partway (a download failed)*: run the same line again. It picks up where it left off, and your drafts are never touched.
- *"npm ci can only install packages when your package.json and package-lock.json are in sync"* at **Building the app**: Quire 0.1.0 had this bug (its lockfile was out of date). Run the install line again: it switches to 0.1.1, where it is fixed, and carries on.
- Anything else: [open an issue](https://github.com/chakradhar09/quire/issues) with the last lines the installer printed.

## Getting a Brave Search API key

Quire finds matching sources with [Brave Search](https://brave.com/search/api/), which needs a key of your own. You set it up once; it takes about five minutes. (These steps describe Brave's site as of 2026; its pages and prices may change.)

1. **Create an account.** Go to [api-dashboard.search.brave.com/register](https://api-dashboard.search.brave.com/register), sign up with your email and a password, and confirm the email Brave sends you.
2. **Choose a plan.** In the dashboard, open **Subscriptions** (or **Plans**) and subscribe to the **Search** plan. It is the one for web search; the "Data for AI" plans won't work with Quire.
3. **Add a payment card.** Brave asks for one even if you never pay: every account gets **$5 of free credit each month**, about 1,000 searches, and you are only charged for searches beyond that. Quire uses up to 10 searches per check, so the free credit covers about **100 checks a month**. If the dashboard offers a monthly spending limit, set it to $0 or $5 to be safe.
4. **Create the key.** Open **API Keys** in the dashboard, click **Add API key**, name it "Quire", and copy the key it shows: one long string of letters and digits.
5. **Paste it into Quire.** Open Quire, click **Settings** in the top bar, paste the key into **Key** and click **Save key**. You'll see "Saved", and the key shows as `••••••••` and its last four characters from then on. The next check uses it; nothing needs restarting.

The key is saved only on your PC (in the `data` folder), and the only thing sent to Brave is the short phrases being searched.

**If something goes wrong**

- *"Add your Brave Search API key"* on Drafts or Check a draft: no key is saved yet; follow the steps above.
- *"Brave Search rejected the API key"* on a report: the key was mistyped, deleted in the dashboard, or its plan isn't active. Paste it again on the Settings page (**Replace**), and check the plan in the Brave dashboard.
- *"Brave rate limit"*: too many searches at once or the month's quota is used up. Retry the check from Drafts later.
- **Fewer or more sources:** `SEARCH_QUERY_BUDGET` in `app/worker/.env` sets the searches per check (10 after installing). More finds more sources and uses the monthly credit faster.

## Use

Open **Quire** from the Start menu (or run `quire`). It starts in the background and opens in your browser at `http://127.0.0.1:3000`. Drop a file or paste your text on **Check a draft**; the check runs on its own and the report opens from **Drafts** when it is ready. **Stop Quire** (or `quire --stop`) shuts it down.

## Updates

When a new release is out, an **Update** notice appears in Quire's header. Install it with **Update Quire** (or `quire-update`), or switch on **Install new releases automatically when Quire starts** on the Settings page. Your drafts and reports are kept.

**Installed Quire on 3 November 2026 or earlier?** Run the [install line](#install) again, once. 0.1.0 couldn't finish installing, and its updater can't see newer releases (**Update Quire** says "model-v5" is the latest, or shows an error on Windows). The installer switches you to the newest release and keeps your drafts and settings; updates work normally after that.

## Uninstall

**Windows:** **Uninstall Quire** in the Start menu (in the Quire folder), or **Settings > Apps > Quire > Uninstall**.

**macOS and Linux:** run `quire-uninstall`, or if that command isn't there:

```bash
curl -fsSL https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/uninstall.sh | bash
```

It asks before removing anything, and asks whether to keep your drafts, reports and settings. Kept, they move to **Documents\Quire data &lt;date&gt;** (Windows) or **~/Quire-data-&lt;date&gt;**. It removes Quire, its shortcuts and commands, and the private Python and Node.js if the installer added them; Git, Node.js or Python that you (or winget or Homebrew) installed stay, since other programs may use them.

## Privacy and safety

- **What leaves your PC:** the short phrases sent to Brave Search for the similarity check, the pages it then fetches, and once a day a request to GitHub for the latest release number (`QUIRE_UPDATE_CHECK=off` in the environment turns that off). Your files never leave.
- **Where your work lives:** the `data` folder inside the install: uploads, extracted text, reports and the database. Delete it, or [uninstall](#uninstall) without keeping your data, to remove everything.
- **Quire has no login and must never be exposed to a network.** It only answers on `127.0.0.1`; don't put it behind a proxy or open its port to other machines.

## How it works

A Next.js app (`web/`) shows the pages and queues work in a SQLite database; a Python worker (`worker/`) reads files, runs the web searches, aligns matches and scores AI-like writing, then writes the results back. The worker starts when there is something to check and stops after five idle minutes. The full design is in [`replica/architecture.md`](replica/architecture.md) and [`DESIGN.md`](DESIGN.md).

## Development

```bash
git clone https://github.com/chakradhar09/quire.git && cd quire
python -m venv worker/.venv
worker/.venv/bin/pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu   # or .../whl/cu130
worker/.venv/bin/pip install -r worker/requirements.txt   # requirements-calibration.txt to train the classifier
cp worker/.env.example worker/.env        # optional settings; the Brave key goes on the Settings page
cd web && npm ci && npm run dev           # http://127.0.0.1:3000
```

On Windows the virtual environment's executables are in `worker\.venv\Scripts\`. Tests: `npm test`, `npx tsc --noEmit` and `npx eslint app components lib` in `web/`; `python -m unittest discover -p "*_test.py"` in `worker/`. Training and evaluating the classifier: `worker/calibration/` (see [MODEL.md](MODEL.md)).

## Licence

The code is licensed under the [GNU Affero General Public License v3.0](LICENSE): you can use, study, change and share it, and if you offer a modified version to others as a service you must publish your changes. The trained AI-writing model is licensed separately for **non-commercial** use, because some of its training data is; see [MODEL.md](MODEL.md).

Quire is an independent project. It is not affiliated with or endorsed by Turnitin or any other commercial checker.

# Releasing Quire

The installer installs the newest `v*` tag, `update` moves to it, and the app's update notice reads GitHub's latest **published release**, comparing it with `version` in `web/package.json`. So a release needs all three: the version bumped, the tag, and a GitHub release.

## A new version

1. In `web/`: `npm version 0.2.0 --no-git-tag-version` (sets `package.json` and `package-lock.json`).
2. Make sure **CI** is green on `main` (GitHub, Actions): `.github/workflows/ci.yml` runs the app's tests, types, lint and build on Node.js 22 and 24, the worker's tests, ShellCheck and a PowerShell parse of the scripts, and a real install, run and uninstall of the commit on Linux and Windows. By hand, the same is `npm test`, `npx tsc --noEmit`, `npx eslint app components lib` and `npm run build` in `web/`, and `python -m unittest discover -p "*_test.py"` in `worker/`.
   CI's `npm ci` on both Node.js versions also checks that the lockfile installs the way the installer does. 0.1.0 shipped a `package-lock.json` missing `@emnapi/core` and `@emnapi/runtime`; no npm would `ci` it, so every install stopped at "Building the app" (a dev copy with `node_modules` already in place doesn't notice). Fix one with `npx -y npm@10 install --package-lock-only` and commit the result.

   (0.1.1 fixed it. The installer and the updaters fetch tags with `--force`, so a moved tag would also reach existing installs, but prefer a new version: a moved tag doesn't show the update notice, because `package.json`'s version is unchanged.)
3. Write what changed for people using Quire in `release-notes/v0.2.0.md` (see the earlier ones). Without that file the release gets notes made from the commit titles.
4. Commit and push to `main`. When CI passes on that commit, `.github/workflows/release.yml` sees a version with no tag yet, creates the `v0.2.0` tag on the commit and publishes the GitHub release with those notes. Publishing it is what makes the update notice appear. (Pushing a `v0.2.0` tag yourself works too: CI runs on it, the tag is checked against `package.json`, and the release is published. A release you made by hand is left as it is.)
5. If the release changes the PyTorch version (`TorchVersion` in `scripts/install.ps1`, `TORCH_VERSION` in `scripts/install.sh`), say in the notes to run the installer again: `update` does not reinstall PyTorch.

## The AI-writing model

The model ships as a release asset, separate from the code, so updates don't download it again.

1. Zip the contents of `data/calibration/classifier/model` (the files at the root of the zip, not in a folder):
   - Windows: `Compress-Archive data\calibration\classifier\model\* quire-classifier-v5.zip`
   - macOS/Linux: `(cd data/calibration/classifier/model && zip -r ../../../../quire-classifier-v5.zip .)`
2. On GitHub, create a release with the tag `model-v5` (mark it as a pre-release so it never counts as the app's latest) and attach `quire-classifier-v5.zip`.
3. A new model gets a new tag and file name (`model-v6`, `quire-classifier-v6.zip`). Update `ModelUrl` and `ModelEnv` in `scripts/install.ps1`, the matching lines in `scripts/install.sh`, and `MODEL.md`.

## The first public release

`scripts/new-public-repo.ps1` makes a fresh copy of this repository with a single commit (no earlier history, so no earlier author email) in a folder of your choice. It does not push anything. Then:

1. Create an empty public repository named `quire` on GitHub (no README or licence: they are in the copy).
2. In the copy: `git remote add origin https://github.com/<you>/quire.git`, then `git push -u origin main`.
3. If the account is not `chakradhar09`, replace that name in `scripts/install.ps1`, `scripts/install.sh`, `web/lib/updates.ts`, `README.md`, `MODEL.md` and this file first.
4. Release `v0.1.0` and `model-v5` as above.

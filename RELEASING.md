# Releasing Quire

The installer installs the newest `v*` tag, `update` moves to it, and the app's update notice reads GitHub's latest **published release**, comparing it with `version` in `web/package.json`. So a release needs all three: the version bumped, the tag, and a GitHub release.

## A new version

1. In `web/`: `npm version 0.2.0 --no-git-tag-version` (sets `package.json` and `package-lock.json`).
2. Run the checks: `npm test`, `npx tsc --noEmit`, `npx eslint app components lib` and `npm run build` in `web/`; `python -m unittest discover -p "*_test.py"` in `worker/`. The production build catches things the dev server doesn't.
   Then check that the lockfile installs the way the installer does: in a fresh copy of `web/` (no `node_modules`), `npm ci`, and `npx -y npm@10 ci` for Node.js 22's npm. The first build of 0.1.0 shipped a `package-lock.json` missing `@emnapi/core` and `@emnapi/runtime`; no npm would `ci` it, so every install stopped at "Building the app" (a dev copy with `node_modules` already in place doesn't notice). Fix one with `npx -y npm@10 install --package-lock-only` and commit the result.

   (That build was fixed by moving the `v0.1.0` tag to the fixed commit. The installer and the updaters fetch tags with `--force`, so moving a tag reaches existing installs, but prefer a new version: a moved tag doesn't show the update notice, because `package.json`'s version is unchanged.)
3. Commit, then `git tag v0.2.0` and `git push origin main v0.2.0`.
4. On GitHub, **Releases → Draft a new release** from the tag, with a few lines on what changed. Publishing it is what makes the update notice appear.
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

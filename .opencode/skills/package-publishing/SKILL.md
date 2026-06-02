---
name: package-publishing
description: Publish npm packages and GitHub releases from this opencode-plugins monorepo. Use when asked to release, publish, version, or bootstrap a package.
---

# Package Publishing

Use the repository workflows. Do not commit, push, merge, or publish until the
user explicitly requests it. Preserve unrelated worktree changes and never
stage local connection strings.

## Repository Release Setup

- Workspaces live under `packages/*`.
- Root `npm run release` runs `changeset publish`.
- `.github/workflows/release.yml` runs on pushes to `main` and uses npm trusted
  publishing through GitHub OIDC.
- `.changeset/README.md` documents the normal changeset flow.
- Review `git status`, `git diff`, `git diff --cached`, and
  `git log --oneline -10` before committing.

## Validate Before Release

Run package-level checks first, then repository checks:

```sh
npm run typecheck -w <package>
npm run build -w <package>
npm run smoke -w <package>
npm run pack:dry-run -w <package>
npm run typecheck
npm run build
npm run smoke
npm run pack:dry-run
git diff --check
```

Inspect the dry-run tarball contents. Verify secrets and local wrappers are not
staged. Stage only intended release files.

## Existing Package Release

For a user-facing change to an already published package:

1. Add a changeset with `npx changeset`.
2. Commit and push the implementation plus changeset when requested.
3. Monitor CI and Release with `gh run list` and `gh run watch`.
4. The Changesets action opens `ci: version packages` PR.
5. Review the PR diff. Merge only when requested.
6. Monitor the post-merge CI and Release runs.
7. Verify npm with `npm view <package> version`.
8. Verify GitHub release with `gh release view "<package>@<version>"`.

## New Package Initial Release

New packages are different. This repository starts them at `0.1.0` and does
not add a changeset for the initial publish, matching `opencode-keep-going`.

1. Add the workspace package and run `npm install --package-lock-only`.
2. Install dependencies if local verification requires them with `npm install`.
3. Confirm the name is available with `npm view <package> version`. Expect npm
   `E404` before the first publish.
4. Validate, commit, and push when requested.
5. Monitor CI and Release.

The Release workflow discovers unpublished packages automatically. However,
npm trusted publishing cannot create a brand-new npm package. The first
workflow publish can fail with npm `E404` on `PUT` even though package
validation passed.

Bootstrap the package once with local npm authentication:

```sh
npm whoami
npm publish -w <package> --access public --provenance=false
```

If npm returns `EOTP`, ask the user to run the same publish command in their
terminal and complete the browser authorization URL. Never expose or store npm
tokens or auth URLs.

After the manual initial publish:

1. Verify `npm view <package> version` and `npm view <package> dist-tags --json`.
2. Configure npm trusted publishing for the new package if it is not already
   configured: GitHub owner `vimtor`, repository `opencode-plugins`, workflow
   `release.yml`.
3. If the failed workflow did not create a GitHub release, create it at the
   pushed commit:

```sh
gh release create "<package>@<version>" \
  --target <commit> \
  --title "<package>@<version>" \
  --notes "Initial release."
```

4. Rerun the failed Release workflow and confirm it passes:

```sh
gh run rerun <run-id> --failed
gh run watch <run-id> --exit-status
```

## Final Report

Include:

- Published npm package and version.
- GitHub release URL.
- CI and Release workflow results.
- Commit SHA.
- Remaining unstaged local-only files.

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
- Use Bun 1.4.0, recorded in the root `packageManager` field, and commit `bun.lock`.
- Build outputs (`dist/`) and source maps are Git-ignored. Builds generate the
  files included in published tarballs; hand-written root entrypoint wrappers are tracked.
- Root `bun run release` runs `changeset publish`.
- `.github/workflows/release.yml` runs on pushes to `main` and uses npm trusted
  publishing through GitHub OIDC.
- Changesets invokes the npm CLI for publishing. The release job installs Node.js
  and current npm for that purpose; workspace installation and tests use Bun.
- `.changeset/README.md` documents the normal changeset flow.
- Review `git status`, `git diff`, `git diff --cached`, and
  `git log --oneline -10` before committing.

## V2 Package Conventions

- Use `@opencode/plugin` as a runtime dependency, pinned to the targeted beta.
- Server plugins default-export `Plugin.define({ id, setup })` through `.`.
- CLI plugins import `@opencode/plugin/tui` and export `./tui`. Configure
  CLI-only packages in global `~/.config/opencode/cli.json` under `plugins`.
- Local CLI directory loading needs a top-level `tui` entrypoint. These packages
  use `tui.js` exporting `./dist/tui.js`; include it in the package's `files`.
  npm's `exports` mapping alone does not cover this loading path.
- Register CLI keymap layers inside a mounted slot's `render` callback, such
  as `app` or `prompt.footer`. Return the slot cleanup from `setup`.
- Check `opencode2 --version` before trying a plugin in the terminal. The V2
  CLI package is `@opencode/cli`; it must support the targeted plugin API.
- Confirm commands appear in the running client. Import checks and mocked UI
  tests alone do not verify command registration.

## Validate Before Release

Run local typechecks and builds for the affected packages:

```sh
bun run --filter <package> build
bun run --filter <package> typecheck
bun run --filter <package> pack:dry-run --ignore-scripts
git diff --check
```

Runtime tests run in GitHub CI. Its verification sequence is:

```sh
bun run build
bun run typecheck
bun test
bun run test:packages
bun run smoke
bun run pack:dry-run
```

Tests live in `packages/<plugin>/test/*.test.ts` and use `bun:test`, including
Bun's `expect` and `spyOn` APIs. Package typechecks include the tests. Build before
typechecking or running them: they import compiled package exports.
`bun run --filter <package> test` selects one package.

`bun run test:packages` packs each workspace, installs its tarball in an isolated
directory with Bun, and runs the package-local suites there, including CLI
directory loading. `pack:dry-run` invokes prepack smoke checks, so use
`--ignore-scripts` for local package inspection.

Inspect tarball contents for compiled entrypoints, types, and CLI wrappers.
Keep credentials and personal configuration out of commits. Stage only intended
release files.

## Existing Package Release

For a user-facing change to an already published package:

1. Add a changeset with `bunx changeset`.
2. Commit and push the implementation plus changeset when requested.
3. Monitor CI and Release with `gh run list` and `gh run watch`.
4. The Changesets action opens `ci: version packages` PR.
5. Review the PR diff. Merge only when requested.
6. Monitor the post-merge CI and Release runs.
7. Verify npm with `npm view <package> version`.
8. Verify GitHub release with `gh release view "<package>@<version>"`.

## New Package Initial Release

This repository starts new packages at `0.1.0` and does not add a changeset for
the initial publish.

1. Add the workspace package and run `bun install --lockfile-only`.
2. Install dependencies if local verification requires them with `bun install`.
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

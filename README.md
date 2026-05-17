# OpenCode Plugins

Monorepo for OpenCode plugins maintained by vimtor.

## Packages

- `opencode-postgres`: adds a Postgres Query tool for running SQL against a configured Postgres database.
- `opencode-exit-plan`: switches from the `plan` agent to another primary agent when you approve implementation.

## Development

```sh
npm install
npm run typecheck
npm run build
npm run smoke
npm run pack:dry-run
```

Run a package script for one plugin with `-w`:

```sh
npm run typecheck -w opencode-postgres
```

## Local OpenCode

This repo includes root `.opencode/plugins` wrappers, so OpenCode can load local package sources when run from the monorepo root.

Package directories also include `.opencode/plugins` wrappers for working inside a single plugin package.

Restart OpenCode after plugin or config changes.

## Releases

Changesets versions and publishes changed packages independently.

Create a changeset for user-facing changes:

```sh
npx changeset
```

Release metadata points at `vimtor/opencode-plugins`; npm package names stay unchanged.

## License

MIT

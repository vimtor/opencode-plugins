# OpenCode Plugins

My personal plugins for OpenCode V2 (beta).

## Packages

- [`opencode-postgres`](packages/opencode-postgres/README.md): adds a Postgres Query tool for running SQL against a configured Postgres database.
- [`opencode-mysql`](packages/opencode-mysql/README.md): adds a MySQL Query tool for running SQL against a configured MySQL 8+ database.
- [`opencode-exit-plan`](packages/opencode-exit-plan/README.md): switches from the plan mode to a build agent when you say phrases like "go ahead".
- [`opencode-keep-going`](packages/opencode-keep-going/README.md): sends a continue prompt when you press Enter on an empty input.
- [`opencode-quick-links`](packages/opencode-quick-links/README.md): searches and opens links from the active conversation.

## Development

Use Bun 1.4.0.

```sh
bun install
bun run build
bun run typecheck
bun test
bun run test:packages
bun run smoke
bun run pack:dry-run
```

Tests live in each package's `test/*.test.ts` files and use `bun:test`. Build first;
tests and their typechecks use the package's compiled exports. `bun run test:packages` runs
the same suites against tarballs installed in an isolated directory.

Run scripts for one plugin with `--filter`:

```sh
bun run --filter opencode-postgres build
bun run --filter opencode-postgres typecheck
bun run --filter opencode-postgres test
```

Releases use Changesets and npm trusted publishing. The release workflow installs
Node.js and the npm CLI for publishing; dependency installation and tests use Bun.

Start local databases for the Postgres and MySQL plugins:

```sh
docker compose up -d --wait
```

The local Postgres wrapper connects on port `5432`. The local MySQL wrapper connects on port `3307` so it can coexist with other MySQL services using the default port.

## License

MIT

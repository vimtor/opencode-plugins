# OpenCode Plugins

My personal OpenCode plugins.

## Packages

- [`opencode-postgres`](packages/opencode-postgres/README.md): adds a Postgres Query tool for running SQL against a configured Postgres database.
- [`opencode-mysql`](packages/opencode-mysql/README.md): adds a MySQL Query tool for running SQL against a configured MySQL 8+ database.
- [`opencode-exit-plan`](packages/opencode-exit-plan/README.md): switches from the plan mode to a build agent when you say phrases like "go ahead".
- [`opencode-keep-going`](packages/opencode-keep-going/README.md): sends a continue prompt when you press Enter on an empty input.
- [`opencode-quick-links`](packages/opencode-quick-links/README.md): searches and opens links from the active conversation.

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

Start local databases for the Postgres and MySQL plugins:

```sh
docker compose up -d --wait
```

The local Postgres wrapper connects on port `5432`. The local MySQL wrapper connects on port `3307` so it can coexist with other MySQL services using the default port.

## License

MIT

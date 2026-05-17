# OpenCode Plugins

My personal OpenCode plugins.

## Packages

- [`opencode-postgres`](packages/opencode-postgres/README.md): adds a Postgres Query tool for running SQL against a configured Postgres database.
- [`opencode-exit-plan`](packages/opencode-exit-plan/README.md): switches from the plan mode to a build agent when you say phrases like "go ahead".
- [`opencode-keep-going`](packages/opencode-keep-going/README.md): sends a continue prompt when you press Enter on an empty input.

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

## License

MIT

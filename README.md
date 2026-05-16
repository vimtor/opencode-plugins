# OpenCode Postgres

OpenCode plugin that adds a Postgres Query tool for running SQL against a configured Postgres database.

## Install

Add the plugin to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-postgres"]
}
```

## Configure

Use tuple config to provide the Postgres connection string and read-only mode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-postgres",
      {
        "connectionString": "postgres://user:password@localhost:5432/database",
        "readOnly": true
      }
    ]
  ]
}
```

Options:

- `connectionString`: Postgres connection string. Required.
- `readOnly`: Run queries in a read-only transaction. Defaults to `true`.

The tool is available as `postgres_query` and is described to agents as Postgres Query. It accepts one argument:

```json
{
  "query": "select now()"
}
```

Use a database role with the minimum privileges needed. `readOnly` adds a safety check, but database permissions should be the source of truth.

## Local Development

This repo includes `.opencode/plugins/postgres.ts`, so OpenCode can load the local source directly while developing.

```sh
npm install
npm run typecheck
npm run build
npm run smoke
```

Restart OpenCode after plugin or config changes.

## License

MIT

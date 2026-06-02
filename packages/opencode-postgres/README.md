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

## Permissions

The tool uses OpenCode's native permission system with the `postgres_query` permission key. If `permission.postgres_query` is not configured, OpenCode's native fallback applies, which currently allows most permissions.

To ask before Postgres queries:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "postgres_query": "ask"
  }
}
```

You can also explicitly allow or deny the tool:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "postgres_query": "allow"
  }
}
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "postgres_query": "deny"
  }
}
```

Choosing **always** in a prompt allows additional Postgres queries for the current OpenCode session.

The tool is available as `postgres_query` and its description identifies whether it is configured as `(read-only)` or `(read/write)`. It accepts one argument:

```json
{
  "query": "select now()"
}
```

Use a database role with the minimum privileges needed. `readOnly` adds a safety check, but database permissions should be the source of truth.

## Local Development

This package includes `.opencode/plugins/postgres.ts`, so OpenCode can load the local source directly while developing inside the package directory.

From the monorepo root:

```sh
npm install
npm run typecheck -w opencode-postgres
npm run build -w opencode-postgres
npm run smoke -w opencode-postgres
```

Restart OpenCode after plugin or config changes.

## License

MIT

# OpenCode Postgres

OpenCode plugin that adds a Postgres Query tool for running SQL against a configured Postgres database.

Requires OpenCode V2 (beta).

## Install

Add the plugin to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-postgres"]
}
```

## Configure

Use an object entry to provide the Postgres connection string and read-only mode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-postgres",
      "options": {
        "connectionString": "postgres://user:password@localhost:5432/database",
        "readOnly": true
      }
    }
  ]
}
```

Options:

- `connectionString`: Postgres connection string. Required.
- `readOnly`: Run queries in a read-only transaction. Defaults to `true`.

## Permissions

Queries use the `postgres_query` permission action with resource `*`. OpenCode checks permissions before executing SQL.

To ask before Postgres queries:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "postgres_query", "resource": "*", "effect": "ask" }
  ]
}
```

You can also explicitly allow or deny the tool:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "postgres_query", "resource": "*", "effect": "allow" }
  ]
}
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "postgres_query", "resource": "*", "effect": "deny" }
  ]
}
```

Choosing **always** saves an approval for the current project across sessions. Configured deny rules still apply.

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

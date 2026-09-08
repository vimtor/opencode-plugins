# OpenCode MySQL

OpenCode plugin that adds a MySQL Query tool for running SQL against a configured MySQL 8+ database.

Requires OpenCode V2 (beta).

## Install

Add the plugin to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-mysql"]
}
```

## Configure

Use an object entry to provide the MySQL connection string and read-only mode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-mysql",
      "options": {
        "connectionString": "mysql://user:password@localhost:3306/database",
        "readOnly": true
      }
    }
  ]
}
```

Options:

- `connectionString`: MySQL connection string. Required.
- `readOnly`: Run queries in a read-only transaction. Defaults to `true`.

Each tool call runs one SQL statement. Multi-statement execution remains disabled even if the connection string requests it.

## Permissions

Queries use the `mysql_query` permission action with resource `*`. OpenCode checks permissions before executing SQL.

To ask before MySQL queries:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "mysql_query", "resource": "*", "effect": "ask" }
  ]
}
```

You can also explicitly allow or deny the tool:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "mysql_query", "resource": "*", "effect": "allow" }
  ]
}
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "mysql_query", "resource": "*", "effect": "deny" }
  ]
}
```

Choosing **always** saves an approval for the current project across sessions. Configured deny rules still apply.

The tool is available as `mysql_query` and its description identifies whether it is configured as `(read-only)` or `(read/write)`. It accepts one argument:

```json
{
  "query": "select now()"
}
```

Use a database role with the minimum privileges needed. `readOnly` uses MySQL 8's transaction-level read-only mode, but MySQL still permits changes to temporary tables. Database permissions should be the source of truth.

## Local Development

This package includes `.opencode/plugins/mysql.ts`, so OpenCode can load the local source directly while developing inside the package directory.

From the monorepo root:

```sh
npm install
npm run typecheck -w opencode-mysql
npm run build -w opencode-mysql
npm run smoke -w opencode-mysql
```

Restart OpenCode after plugin or config changes.

## License

MIT

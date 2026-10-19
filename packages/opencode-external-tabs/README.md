# opencode-external-tabs

OpenCode TUI plugin that opens sessions created by other clients, such as `opencode run`, the SDK, or agent tools, as background tabs.

Requires OpenCode V2 2.0.28 or later with session tabs enabled.

## Install

Add the package to your global `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-external-tabs"]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

When another client creates a session, the plugin opens it as a tab without changing the current session. Subagent sessions are skipped.

Only sessions created while the TUI is connected open. Closed tabs are not reopened.

To open a session only when it needs you, create it with session metadata `tab: false`, then set `tab: true` when it should open. A scheduled job can create its session with `opencode api post /api/session --data '{"id":"ses_job_20261019","metadata":{"tab":false}}'`, run, then call `opencode api patch /api/session/ses_job_20261019 --data '{"metadata":{"tab":true}}'` if it has a question. Each update to `tab: true` opens the tab again, even after you close it.

The plugin follows your `tabs.scope` setting in `cli.json`. With `cwd`, the default, only sessions in OpenCode's current directory open. With `global`, root sessions from any directory open. Scope changes apply without a restart.

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/external-tabs/` when run from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-external-tabs build
bun run --filter opencode-external-tabs typecheck
bun run --filter opencode-external-tabs test
bun run --filter opencode-external-tabs smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

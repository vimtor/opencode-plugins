# opencode-keep-going

OpenCode TUI plugin that sends a continue prompt when you press Enter on an empty input.

Requires OpenCode V2 (beta).

## Install

Add the package to your global `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-keep-going"]
}
```

OpenCode installs npm plugins automatically at startup.

## Configure

By default, `opencode-keep-going` sends a hidden `Continue.` message.

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "opencode-keep-going",
      "options": {
        "hidden": true,
        "message": "Continue."
      }
    }
  ]
}
```

Set `hidden` to `false` to send a normal user prompt visible in chat history. Hidden continuation uses V2 synthetic messages. Both resume the current session with its selected agent and model.

The binding is active in the normal session composer. Non-empty input falls through to normal submission. Shell mode and modal input modes retain their own bindings.

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/keep-going/` when run from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-keep-going build
bun run --filter opencode-keep-going typecheck
bun run --filter opencode-keep-going test
bun run --filter opencode-keep-going smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

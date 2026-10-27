# opencode-keep-going

OpenCode plugin that sends a continue prompt when you press Enter on an empty input.

Requires OpenCode V2 (beta). OpenCode Desktop support requires OpenCode 2.2.0 or later.

## Install

Add the package to your global `~/.config/opencode/opencode.json` to use it in both the TUI and OpenCode Desktop:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-keep-going"]
}
```

OpenCode Desktop only loads plugins from the global `opencode.json`. To use the plugin in the TUI alone, you can list it in `~/.config/opencode/cli.json` instead. Use one file or the other, not both.

OpenCode installs npm plugins automatically at startup.

## Configure

By default, `opencode-keep-going` sends a hidden `Continue.` message.

```json
{
  "$schema": "https://opencode.ai/config.json",
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

In OpenCode Desktop, Enter continues the session when the prompt has no text. Shell mode and subagent sessions keep their own Enter. The plugin can't see attachments, so a prompt with only an attachment, a quote, or a comment and no text sends the continue message instead; type some text to send it as usual.

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

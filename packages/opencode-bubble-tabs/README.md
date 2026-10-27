# opencode-bubble-tabs

OpenCode plugin that moves session tabs to the front when they need you, like conversations in iMessage.

Requires OpenCode V2 2.0.28 or later with session tabs enabled in the TUI. OpenCode Desktop support requires OpenCode 2.2.0 or later.

## Install

Add the package to your global `~/.config/opencode/opencode.json` to use it in both the TUI and OpenCode Desktop:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-bubble-tabs"]
}
```

OpenCode Desktop only loads plugins from the global `opencode.json`. To use the plugin in the TUI alone, you can list it in `~/.config/opencode/cli.json` instead. Use one file or the other, not both.

OpenCode installs npm plugins automatically at startup.

## Use

A session's tab moves to the front when its turn finishes or fails, or when it asks for a permission or a question. Permissions and questions from subagents move their parent session's tab.

In OpenCode Desktop, the plugin moves the tabs of sessions on the app's own server, in every window that has them open.

## Configure

Set `options.on` to choose what moves a tab:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-bubble-tabs",
      "options": { "on": ["prompt", "done", "ask"] }
    }
  ]
}
```

- `"done"`: its turn finishes or fails.
- `"ask"`: it asks for a permission or a question.
- `"prompt"`: you submit a prompt.

Defaults to `["done", "ask"]`.

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/bubble-tabs/` when run from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-bubble-tabs build
bun run --filter opencode-bubble-tabs typecheck
bun run --filter opencode-bubble-tabs test
bun run --filter opencode-bubble-tabs smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

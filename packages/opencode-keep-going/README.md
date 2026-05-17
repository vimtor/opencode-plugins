# opencode-keep-going

OpenCode TUI plugin that sends a continue prompt when you press Enter on an empty input.

## Install

Add the package to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-keep-going"]
}
```

OpenCode installs npm plugins automatically at startup.

## Configure

By default, `opencode-keep-going` sends a hidden `Continue.` message.

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "opencode-keep-going",
      {
        "hidden": true,
        "message": "Continue."
      }
    ]
  ]
}
```

Set `hidden` to `false` to show the message in chat history.

## Local Development

This package includes `.opencode/tui.json`, so OpenCode loads the local source when you run it from the package directory.

From the monorepo root:

```sh
npm install
npm run typecheck -w opencode-keep-going
npm run build -w opencode-keep-going
npm run smoke -w opencode-keep-going
```

Restart OpenCode after changing plugin files or config.

## License

MIT

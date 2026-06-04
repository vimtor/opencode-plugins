# opencode-quick-links

OpenCode TUI plugin for searching and opening links from the active conversation.

## Install

Add the package to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-quick-links"]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

Select **Open session links** from the command palette or run `/links`. Search the dialog and press Enter to open the selected URL in your browser.

The plugin scans the active conversation when you open the dialog. It includes HTTP and HTTPS links from user and assistant messages and removes duplicates.

## Configure

The plugin does not register a default shortcut. Add one through your OpenCode TUI config if wanted:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-quick-links"],
  "keybinds": {
    "quick-links.open": "<leader>l"
  }
}
```

## Local Development

This package includes `.opencode/tui.json`, so OpenCode loads the local source when you run it from the package directory.

From the monorepo root:

```sh
npm install
npm run typecheck -w opencode-quick-links
npm run build -w opencode-quick-links
npm run smoke -w opencode-quick-links
```

Restart OpenCode after changing plugin files or config.

## License

MIT

# opencode-quick-links

OpenCode TUI plugin for searching and opening links from the active conversation.

Requires OpenCode V2 (beta).

## Install

Add the package to your global `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-quick-links"]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

Select **Open session links** from the command palette or run `/links`. Search the dialog and press Enter to open the selected URL in your browser.

The plugin scans the active conversation when you open the dialog. It includes HTTP and HTTPS links from user and assistant messages and removes duplicates.

## Configure

The plugin does not register a default shortcut. Add one through `cli.json` if wanted:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-quick-links"],
  "keybinds": {
    "quick-links.open": "<leader>o"
  }
}
```

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/quick-links/` when run from the package directory.

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

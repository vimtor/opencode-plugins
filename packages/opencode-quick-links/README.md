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

The plugin scans the active conversation when you open the dialog. It includes HTTP and HTTPS links from user messages, assistant messages, and tool outputs, lists the most recent first, and removes duplicates.

## Configure

No shortcut is assigned by default. Set `options.keybind` on the plugin entry in `cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "opencode-quick-links",
      "options": { "keybind": "ctrl+shift+o" }
    }
  ]
}
```

Use any OpenCode key sequence, such as `alt+l` or `<leader>o`. Omit `keybind`, or set it to `false` or `"none"`, to disable the shortcut. `/links` and the command palette remain available.

OpenCode's top-level `keybinds` configuration currently accepts built-in command IDs only; configure this plugin's shortcut through `options.keybind` instead.

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/quick-links/` when run from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-quick-links build
bun run --filter opencode-quick-links typecheck
bun run --filter opencode-quick-links test
bun run --filter opencode-quick-links smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

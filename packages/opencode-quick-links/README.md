# opencode-quick-links

OpenCode plugin for searching and opening links from the active conversation.

Requires OpenCode V2 (beta). OpenCode Desktop support requires OpenCode 2.2.0 or later.

## Install

Add the package to your global `~/.config/opencode/opencode.json` to use it in both the TUI and OpenCode Desktop:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-quick-links"]
}
```

OpenCode Desktop only loads plugins from the global `opencode.json`. To use the plugin in the TUI alone, you can list it in `~/.config/opencode/cli.json` instead. Use one file or the other, not both.

OpenCode installs npm plugins automatically at startup.

## Use

Select **Open session links** from the command palette or run `/links`. Search the dialog and press Enter to open the selected URL in your browser.

The plugin scans the active conversation when you open the dialog. It includes HTTP and HTTPS links from user and assistant text, excludes tool calls and outputs, lists the most recent first, and removes duplicates.

OpenCode Desktop offers the same command and `/links`, and opens the link in your default browser.

## Configure

No shortcut is assigned by default. Set `options.keybind` on the plugin entry. The TUI and OpenCode Desktop both use it, and you can also change the Desktop shortcut in **Settings > Shortcuts**:

```json
{
  "$schema": "https://opencode.ai/config.json",
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

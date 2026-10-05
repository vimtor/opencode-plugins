# opencode-pr-link

OpenCode TUI plugin for opening the current branch's pull request in the browser.

Requires OpenCode V2 (beta) and an authenticated [GitHub CLI](https://cli.github.com) (`gh`).

## Install

Add the package to your global `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-pr-link"]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

Select **Open pull request** from the command palette or press your configured shortcut. The plugin opens the pull request for the checked-out branch in your browser.

Inside a session, the plugin uses the session's directory, so sessions in Git worktrees open their own branch's pull request. Outside a session, it uses OpenCode's current directory.

The plugin runs `gh pr view` in that directory to find the pull request. A warning toast explains when there is nothing to open, such as a branch without a pull request; an error toast reports failures, such as a missing or signed-out `gh`.

## Configure

No shortcut is assigned by default. Set `options.keybind` on the plugin entry in `cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "opencode-pr-link",
      "options": { "keybind": "ctrl+shift+p" }
    }
  ]
}
```

Use any OpenCode key sequence, such as `alt+p` or `<leader>p`. Omit `keybind`, or set it to `false` or `"none"`, to disable the shortcut. The command palette remains available.

OpenCode's top-level `keybinds` configuration currently accepts built-in command IDs only; configure this plugin's shortcut through `options.keybind` instead.

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/pr-link/` when run from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-pr-link build
bun run --filter opencode-pr-link typecheck
bun run --filter opencode-pr-link test
bun run --filter opencode-pr-link smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

# opencode-quick-links

## 1.2.0

### Minor Changes

- 0d35ac4: Include links from tool outputs and list the most recent links first.

## 1.1.0

### Minor Changes

- b311243: Add an optional keybind plugin setting for opening Quick Links. Configure or disable the shortcut through plugin options instead of OpenCode's built-in-only keybind overrides.

## 1.0.1

### Patch Changes

- 74ff086: Hide HTTP/HTTPS protocols in link previews and clarify the conversation links search placeholder.

## 1.0.0

### Major Changes

- 2ee40fc: Require OpenCode V2 (beta) and use its new plugin APIs. Configure server plugins in `opencode.json(c)` and terminal plugins in global `cli.json`.

### Patch Changes

- 2ae2b2a: Exclude Markdown closing punctuation and text after unmatched closing parentheses from extracted links while preserving balanced URL parentheses.

## 0.1.1

### Patch Changes

- ecdc427: Test automated trusted publishing for quick links.

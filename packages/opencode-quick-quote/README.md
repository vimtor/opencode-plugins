# Quick Quote

Inline quote completion for OpenCode V2 (2.0.28 or newer).

Type `>` at the start of any prompt line to browse paragraphs from the latest
assistant response group. Replies to the same user prompt stay together, including
follow-ups after background notifications, in conversation order. While a new
prompt is unanswered, the last available response group stays quotable.

Type `>search words` to filter, use ↑/↓ to choose, then Enter
to insert the complete Markdown blockquote. The cursor moves to a blank reply
line. Repeat to quote several paragraphs in one draft.

Escape dismisses the list and leaves your draft intact. Enter with no matches
keeps the search open. List items are individually selectable; code blocks and
tables stay together. Completion is disabled inside fenced code and shell mode.

## OpenCode Desktop

OpenCode Desktop 2.2.0 or later has no inline list. Run `/quote`, or
**Quote the last reply** from the command palette, to pick a paragraph from the
same response group. Add words after `/quote` to filter, such as `/quote cache`.
The paragraph is attached to your prompt as a quote, and its comment editor
opens so you can reply to it.

## Install

Add the package to your global `~/.config/opencode/opencode.json` to use it in
both the TUI and OpenCode Desktop:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-quick-quote"]
}
```

OpenCode Desktop only loads plugins from the global `opencode.json`. To use the
plugin in the TUI alone, you can list it in `~/.config/opencode/cli.json`
instead. Use one file or the other, not both.

## Try locally

From the repository root:

```sh
bun install
bun run --cwd packages/opencode-quick-quote build
```

Add the absolute package directory to `plugins` in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["/absolute/path/opencode-plugins/packages/opencode-quick-quote"]
}
```

The inline list uses OpenTUI renderables and the focused prompt's edit-buffer
events. It is plugin-owned; OpenCode's native mention dropdown is internal.
The current plugin API exposes no prompt-editor handle, so the plugin locates
the editor through the `prompt.footer` slot's renderable ancestors.

## Development

```sh
bun run --cwd packages/opencode-quick-quote typecheck
bun run --cwd packages/opencode-quick-quote build
```

Package tests use `bun:test` and run in GitHub CI against both workspace builds
and installed tarballs. The test scripts enable Solid's `browser` condition so
UI lifecycle hooks run as they do in the CLI.

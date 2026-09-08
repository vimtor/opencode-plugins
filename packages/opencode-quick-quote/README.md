# Quick Quote

Inline quote completion for OpenCode V2 (beta-19296). Local prototype.

Type `>` at the start of any prompt line to browse paragraphs from the last
assistant reply. Type `>search words` to filter, use ↑/↓ to choose, then Enter
to insert the complete Markdown blockquote. The cursor moves to a blank reply
line. Repeat to quote several paragraphs in one draft.

Escape dismisses the list and leaves your draft intact. Enter with no matches
keeps the search open. List items are individually selectable; code blocks and
tables stay together. Completion is disabled inside fenced code and shell mode.

## Try locally

From the repository root:

```sh
bun install
bun run --cwd packages/opencode-quick-quote build
```

Add the absolute package directory to `plugins` in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["/absolute/path/opencode-plugins/packages/opencode-quick-quote"]
}
```

The inline list uses OpenTUI renderables and the focused prompt's edit-buffer
events. It is plugin-owned; OpenCode's native mention dropdown is internal.
The current plugin API exposes no prompt-editor handle, so the prototype locates
the editor through the `prompt.footer` slot's renderable ancestors.

## Development

```sh
bun run --cwd packages/opencode-quick-quote typecheck
bun run --cwd packages/opencode-quick-quote build
```

Package tests use `bun:test` and run in GitHub CI.

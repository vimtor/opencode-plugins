# opencode-hide-variants

OpenCode plugin that hides model variants you never use, such as `none` or `low` reasoning effort. Hidden variants disappear from the variant list and from `variant.cycle`.

Requires OpenCode V2.

## Install

Add the package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-hide-variants",
      "options": {
        "variants": ["none", "low"]
      }
    }
  ]
}
```

OpenCode installs npm plugins automatically at startup.

## Configure

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-hide-variants",
      "options": {
        "variants": ["none", "low"],
        "models": {
          "anthropic/claude-opus-4-7": ["max"],
          "gpt-5.5": ["minimal"]
        }
      }
    }
  ]
}
```

- `variants` hides variant IDs from every model.
- `models` maps a model to variant IDs hidden from it, on top of the global list. Each key is either a `provider/model` reference or a bare model ID that matches the model under any provider.

Use the variant IDs shown in the variant list or after `#` in model references, such as `openai/gpt-5.5#high`.

## Caveats

- The TUI always keeps `default` (no variant) in the list and cycle; it cannot be hidden.
- Agents, commands, or runs that select a hidden variant, such as `openai/gpt-5.5#low`, fail model resolution.
- Session title generation prefers a model's `none`, `minimal`, or `low` variant. Hiding them makes titles use the model's default effort.

## Local Development

This package includes `.opencode/plugins/hide-variants.ts`, so OpenCode auto-loads the local source when you run it from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-hide-variants build
bun run --filter opencode-hide-variants typecheck
bun run --filter opencode-hide-variants test
bun run --filter opencode-hide-variants smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

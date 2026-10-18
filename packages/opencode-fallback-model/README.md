# opencode-fallback-model

OpenCode plugin that switches a session to the next model in your fallback list when its model fails, such as on rate limits, outages, or auth errors.

Requires OpenCode V2.

## Install

Add the package to your OpenCode config with the models to fall back to, in order:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-fallback-model",
      "options": {
        "models": ["openai/gpt-5.5#high", "google/gemini-3-pro", "anthropic/claude-sonnet-4-6"]
      }
    }
  ]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

When a model request fails, the plugin switches the session to the first available model in `models` and retries right away, instead of waiting for OpenCode's retries of the failed model. If that model fails too, it moves on to the next one. Once the last model fails, OpenCode handles the error as usual.

- `models` lists `provider/model` references, with an optional `#variant`. A reference without a variant keeps the model's default variant.
- Models that are missing, disabled, or lack the variant are skipped.
- If the failed model is in the list, the plugin continues from the entry after it. A reference without a variant matches every variant of that model.

## Caveats

- The session stays on the fallback model. Switch back in the model picker once the original model works again.
- Switching models drops the provider's prompt cache, so the retried request costs more.
- Errors that happen before a request is sent, such as an unknown model, don't trigger a fallback.
- Requests that fail after the response started streaming continue on the fallback model.

## Local Development

This package includes `.opencode/plugins/fallback-model.ts`, so OpenCode auto-loads the local source when you run it from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-fallback-model build
bun run --filter opencode-fallback-model typecheck
bun run --filter opencode-fallback-model test
bun run --filter opencode-fallback-model smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

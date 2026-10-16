# opencode-auto-model

OpenCode plugin that adds a `router/auto` model. When a session sends its first prompt, the router picks a model and variant for it and switches the session to that model.

The router only decides once per session. Later prompts stay on the picked model, so the prompt cache keeps working.

Requires OpenCode V2 2.0.31 or later.

## Install

Add the package to your OpenCode config and make `router/auto` your default model:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "router/auto",
  "plugins": ["opencode-auto-model"]
}
```

OpenCode installs npm plugins automatically at startup. You can also pick **Auto** under **Model Router** in the model list.

## Use

Without options, every available model that supports tools can be picked, and the router also picks a reasoning effort variant for it.

The router asks a decision model to pick the cheapest model that can handle the prompt. It uses the first one available:

1. [Jev](https://docs.typesafe.ai/) through your OpenCode Console connection.
2. Jev through your OpenRouter connection.
3. A fast, cheap chat model from your catalog, such as GPT 6 Luna, Claude Haiku, or Gemini Flash Lite.

Subagent sessions skip routing and use their parent session's model.

## Configure

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "router/auto",
  "plugins": [
    {
      "package": "opencode-auto-model",
      "options": {
        "models": {
          "anthropic/claude-opus-4-7#high": "hard debugging, architecture, multi-file refactors",
          "openai/gpt-5.5": "routine features, writing straightforward code",
          "openai/gpt-5.5#minimal": "quick questions, small edits, explanations"
        },
        "fallback": "anthropic/claude-opus-4-7#high"
      }
    }
  ]
}
```

- `models` maps each model the router may pick to when to use it. Keys are `provider/model` references; `#variant` pins a variant, while a key without one lets the router pick the variant. Leave a description empty to describe the model by its name, price, and context size. Without `models`, every available model is a candidate.
- `fallback` is the model to use when the decision model fails or is unavailable. Defaults to the first model in `models`, or the newest available model.
- `decider` overrides the decision model, such as `openai/gpt-6-luna#none`. Use `opencode/jev-1.13` or `openrouter/typesafe/jev-1.14` to pin a Jev version.

## Caveats

- Routing adds one decision call, usually under a second with Jev, before the first prompt runs.
- Without `models`, the router can pick free or preview models, since it looks for the cheapest model that can do the job. List the models you trust to avoid that.
- Picking `router/auto` again in an existing session routes the next prompt again, which resets the prompt cache.
- `router/auto` isn't a real model. Only prompts trigger routing, so anything that runs a session before its first prompt fails.

## Local Development

This package includes `.opencode/plugins/auto-model.ts`, so OpenCode auto-loads the local source when you run it from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-auto-model build
bun run --filter opencode-auto-model typecheck
bun run --filter opencode-auto-model test
bun run --filter opencode-auto-model smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

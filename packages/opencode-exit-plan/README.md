# opencode-exit-plan

OpenCode plugin that switches from the `plan` agent to another primary agent when you approve implementation with a phrase like `go ahead`, `let's implement`, `make the changes`, or `ship it`. Default approval phrases include English, Spanish, Simplified Chinese, Portuguese, French, German, Japanese, Korean, Russian, and Hindi variants.

Requires OpenCode V2 (beta).

## Install

Add the package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-exit-plan"]
}
```

OpenCode installs npm plugins automatically at startup.

## Configure

The default target agent is `build`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-exit-plan",
      "options": {
        "agent": "build",
        "phrases": ["go ahead", "ship it", "approved"]
      }
    }
  ]
}
```

`agent` is the target agent ID. The target must exist at the session's location and be visible and primary (or `all`). `phrases` replaces the default phrase list. Synthetic messages do not trigger a switch.

## Local Development

This package includes `.opencode/plugins/exit-plan.ts`, so OpenCode auto-loads the local source when you run it from the package directory.

From the monorepo root:

```sh
npm install
npm run typecheck -w opencode-exit-plan
npm run build -w opencode-exit-plan
npm run smoke -w opencode-exit-plan
```

Restart OpenCode after changing plugin files or config.

## License

MIT

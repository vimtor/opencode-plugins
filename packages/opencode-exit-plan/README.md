# opencode-exit-plan

OpenCode plugin that switches from the `plan` agent to another primary agent when you approve implementation with a phrase like `go ahead`, `let's implement`, `make the changes`, or `ship it`.

## Install

Add the package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-exit-plan"]
}
```

OpenCode installs npm plugins automatically at startup.

## Configure

The default target agent is `build`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-exit-plan",
      {
        "agent": "build",
        "phrases": ["go ahead", "ship it", "approved"]
      }
    ]
  ]
}
```

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

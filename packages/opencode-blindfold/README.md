# opencode-blindfold

OpenCode plugin that lets agents use secrets you provide without seeing their values.

Requires OpenCode V2 (beta) and the TUI.

## How it works

1. The agent calls `blindfold_request` with a name, such as `GITHUB_TOKEN`, and a reason.
2. The TUI opens a dialog where you paste the value. The value goes to the plugin and never to the agent.
3. The agent uses the secret without reading it:
   - In Code Mode, `tools.blindfold.get({ name: "GITHUB_TOKEN" })` returns the value to the running code only.
   - Shell commands receive it as an environment variable, e.g. `$GITHUB_TOKEN`.
4. The plugin replaces the value, and its JSON, URL, base64, and hex encodings, with `[REDACTED:GITHUB_TOKEN]` in:
   - tool results and errors
   - every message and system prompt sent to the model
   - raw provider HTTP requests, as a final safeguard

Secrets are kept in memory and are lost when the OpenCode service restarts. Encoded forms are only redacted when at least 8 characters long, so very short secrets are redacted only in their raw form.

## Install

The package has a server plugin and a TUI plugin. Add it to both configs.

Server plugin, in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-blindfold"]
}
```

TUI plugin, in `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-blindfold"]
}
```

OpenCode installs npm plugins automatically at startup.

The TUI plugin must be in `cli.json` even when the server plugin is configured for a project, because the TUI loads project plugins only from the directory where it was started. If no TUI responds within 5 seconds, the request fails and the agent is told to check this.

## Configure

Server plugin options:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-blindfold",
      "options": {
        "env": true,
        "timeout": 600000
      }
    }
  ]
}
```

- `env`: set secrets as shell environment variables. Defaults to `true`.
- `timeout`: how long to wait for the dialog in milliseconds. Defaults to 10 minutes.

## Limitations

Redaction guards against accidental exposure, not a hostile agent. An agent can transform a value in ways redaction cannot recognize, such as reversing it or printing part of it, or send it to a server it controls. Live shell output shown in the TUI while a command runs is not redacted; the final result is.

## Local Development

OpenCode auto-loads the local source from `.opencode/plugins/blindfold/` when run from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-blindfold build
bun run --filter opencode-blindfold typecheck
bun run --filter opencode-blindfold test
bun run --filter opencode-blindfold smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

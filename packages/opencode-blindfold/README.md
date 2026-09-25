# opencode-blindfold

OpenCode plugin that lets agents use secrets you provide without seeing their values.

Requires OpenCode V2 (beta) and the TUI.

## How it works

1. When a task needs a secret, the agent calls the `blindfold_request` tool with a name, such as `GITHUB_TOKEN`, and a reason. The plugin's system instructions tell the agent to do this instead of asking you to paste secrets into the chat.
2. The TUI opens a dialog where you paste the value. The value goes to the plugin and never to the agent.
3. The agent uses the secret without reading it:
   - In Code Mode, `tools.blindfold.get({ name: "GITHUB_TOKEN" })` returns the value to the running code only.
   - A shell command receives it as an environment variable only when the command names it, e.g. `GH_TOKEN="$GITHUB_TOKEN" gh api user`. OpenCode asks you to approve such commands. Commands that don't name it, such as `printenv`, never get the value.
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
        "shell": { "enabled": true, "approve": true },
        "codemode": { "enabled": true },
        "prompt": { "timeout": 600000 }
      }
    }
  ]
}
```

The values shown are the defaults.

- `shell.enabled`: set secrets as environment variables for shell commands that name them.
- `shell.approve`: ask for your approval before running shell commands that name a secret.
- `codemode.enabled`: provide `blindfold.get` in Code Mode.
- `prompt.timeout`: how long to wait for the dialog, in milliseconds.

## Limitations

Redaction guards against accidental exposure, not a hostile agent. Once you approve a shell command, that program has the real value and can send it anywhere. An agent can transform a value in ways redaction cannot recognize, such as reversing it or printing part of it, or send it to a server it controls. Live shell output shown in the TUI while a command runs is not redacted; the final result is.

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

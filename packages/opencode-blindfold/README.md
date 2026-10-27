# opencode-blindfold

OpenCode plugin that lets agents use secrets you provide without seeing their values.

Requires OpenCode V2 (beta) and the TUI, or OpenCode Desktop 2.2.0 or later.

## How it works

1. When a task needs a secret, the agent calls `blindfold.get` with a name, such as `GITHUB_TOKEN`, and a reason. If the secret isn't stored yet, you're asked for it. The plugin's system instructions tell the agent to do this instead of asking you to paste secrets into the chat.
   - In Code Mode (preferred), `tools.blindfold.get({ name, reason })` returns the value to the running code only.
   - With Code Mode disabled, `blindfold_get` is a regular tool that stores the secret and never returns the value.
2. The TUI or OpenCode Desktop opens a dialog where you paste the value. Desktop hides what you type. The value goes to the plugin and never to the agent. If you don't answer within 10 minutes, the request fails.
3. The agent uses the secret without reading it:
   - In Code Mode, through the value `tools.blindfold.get` returns, e.g. in a `fetch` header.
   - A shell command receives it as an environment variable only when the command names it, e.g. `GH_TOKEN="$GITHUB_TOKEN" gh api user`. OpenCode asks you to approve such commands. Commands that don't name it, such as `printenv`, never get the value.
4. The plugin replaces the value, and its JSON, URL, base64, and hex encodings, with `[REDACTED:GITHUB_TOKEN]` in:
   - tool results and errors
   - every message and system prompt sent to the model
   - raw provider HTTP requests, as a final safeguard

Secrets are kept in memory and are lost when the OpenCode service restarts. Encoded forms are only redacted when at least 8 characters long, so very short secrets are redacted only in their raw form.

## Install

The package has a server plugin, a TUI plugin, and an OpenCode Desktop plugin. Add it to both configs.

Server and Desktop plugin, in `~/.config/opencode/opencode.json`:

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

The TUI plugin must be in `cli.json` even when the server plugin is configured for a project, because the TUI loads project plugins only from the directory where it was started. OpenCode Desktop needs only the `opencode.json` entry. If no TUI or Desktop window responds within 5 seconds, the request fails and the agent is told to check this.

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
        "codemode": { "enabled": true }
      }
    }
  ]
}
```

The values shown are the defaults.

- `shell.enabled`: set secrets as environment variables for shell commands that name them.
- `shell.approve`: ask for your approval before running shell commands that name a secret.
- `codemode.enabled`: provide `blindfold.get` in Code Mode. When `false`, it's a regular tool that never returns the value. At least one of `shell.enabled` and `codemode.enabled` must be `true`.

### Configured secrets

To skip the dialog, list secrets in the `secrets` option. Each one maps a name to a value:

```json
{
  "package": "opencode-blindfold",
  "options": {
    "secrets": {
      "OPENCODE_API_KEY": "op://Agents/OpenCode Zen/credential",
      "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
    }
  }
}
```

- Values starting with `op://` are 1Password [secret references](https://developer.1password.com/docs/cli/secret-reference-syntax/). They're read with the 1Password CLI (`op read`) the first time the agent asks for them, so 1Password may ask you to unlock it. If the read fails, the agent gets an error explaining why instead of a dialog.
- Any other value is the secret itself. Use OpenCode's `{env:NAME}` or `{file:path}` substitution to keep it out of the config file.
- An empty value, such as an `{env:NAME}` whose variable isn't set, is an error when the agent asks for it.

The agent is told which names are configured. Other names still open the dialog.

If you're signed in to more than one 1Password account, blindfold reads from `my.1password.com`. To use another account, set `1password.account`:

```json
{
  "package": "opencode-blindfold",
  "options": {
    "1password": { "account": "acme.1password.com" },
    "secrets": { "OPENCODE_API_KEY": "op://Agents/OpenCode Zen/credential" }
  }
}
```

Options are read when the OpenCode service starts. After changing them, run `opencode service restart`; restarting the app alone keeps the running service.

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

# opencode-blindfold

OpenCode plugin that lets agents use secrets you provide without seeing their values.

Requires OpenCode V2 (beta) and the TUI.

## How it works

1. When a task needs a secret, the agent calls `blindfold.get` with a name, such as `GITHUB_TOKEN`, and a reason. If the secret isn't stored yet, you're asked for it. The plugin's system instructions tell the agent to do this instead of asking you to paste secrets into the chat.
   - In Code Mode (preferred), `tools.blindfold.get({ name, reason })` returns the value to the running code only.
   - With Code Mode disabled, `blindfold_get` is a regular tool that stores the secret and never returns the value.
2. The TUI opens a dialog where you paste the value. The value goes to the plugin and never to the agent. If you don't answer within 10 minutes, the request fails.
3. The agent uses the secret without reading it:
   - In Code Mode, through the value `tools.blindfold.get` returns, e.g. in a `fetch` header.
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

## Multiple keys

`blindfold.get` accepts either a single `name` or an array of names:

```js
// One secret (returns the value directly in Code Mode)
await tools.blindfold.get({ name: "GITHUB_TOKEN", reason: "Clone private repo" })

// Several secrets in one request
const secrets = await tools.blindfold.get({
  names: ["GITHUB_TOKEN", "NPM_TOKEN", "OPENAI_API_KEY"],
  reason: "Publish and test the package",
})
// secrets === { GITHUB_TOKEN: "...", NPM_TOKEN: "...", OPENAI_API_KEY: "..." }
```

One TUI dialog is shown per missing secret. Already stored secrets are reused unless `replace: true` is passed.

## OBS / terminal live output

The plugin redacts final tool results, messages, and provider HTTP requests. It does **not** redact live stdout/stderr shown in the TUI terminal while a command runs. For OBS streams, run sensitive commands through the bundled redacting wrapper:

```powershell
$env:BLINDFOLD_SECRETS_FILE = "C:\path\to\secrets.env"
node scripts/redact-live.mjs -- "node tool.js API_TOKEN"
```

`scripts/redact-live.mjs` reads `NAME=value` lines from the environment file, injects only secrets named by the command, and replaces raw values plus common encodings with `[REDACTED:NAME]` in live output. This wrapper is agent-neutral and can be used from OpenCode, Codex, CI jobs, or an OBS terminal capture.

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

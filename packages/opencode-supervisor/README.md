# opencode-supervisor

OpenCode plugin that has a second model watch your sessions and stop the run when the agent breaks your instructions.

Requires OpenCode V2.

## Install

Add the package to your OpenCode config with a supervisor model and the instructions it enforces:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-supervisor",
      "options": {
        "model": "anthropic/claude-haiku-4-5",
        "instructions": "Never touch production databases. Never push to main."
      }
    }
  ]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

The supervisor reviews your prompts, the agent's tool calls, and its replies against `instructions`, along with the last few messages of the conversation for context. When something breaks them, it stops the current run and adds a notice to the session with the reason. The session stays usable, so you can send another prompt.

Pick a mode for the trade-off between delay and safety:

- `blocking` waits for the verdict before a prompt is accepted or a tool runs, so nothing the supervisor blocks goes through. Each review adds the supervisor model's response time.
- `streaming` reviews in the background without adding delay, but a prompt or tool call may run before the verdict arrives.

Replies stream to the screen as they're generated, so both modes review them once each text block finishes.

## Configure

```json
{
  "package": "opencode-supervisor",
  "options": {
    "model": "anthropic/claude-haiku-4-5",
    "instructions": "Never touch production databases.",
    "mode": "blocking",
    "action": "stop",
    "scope": ["prompts", "tools", "replies"],
    "ignore": ["read", "glob", "grep"],
    "fallback": "allow"
  }
}
```

- `model` is the supervisor, as a `provider/model` reference with an optional `#variant`. Required. A fast model keeps blocking reviews short.
- `instructions` are the rules the supervisor enforces, in plain language. Required.
- `mode` is `blocking` (default) or `streaming`.
- `action` is what happens in blocking mode when something is blocked. `stop` (default) stops the run. `deny` rejects only the prompt or tool call; the agent sees the reason as the tool's error and can try something else. Streaming mode always stops.
- `scope` lists what to review: `prompts`, `tools`, and `replies`. Defaults to all three.
- `ignore` lists tool names to skip, such as read-only tools, to save time and cost.
- `fallback` is what to do when the supervisor fails, times out after 30 seconds, or gives an unreadable verdict: `allow` (default) lets it through, `block` treats it as a violation.

## Caveats

- A blocked prompt shows OpenCode's "Failed to send prompt" error; the notice with the reason appears when the session next runs.
- The supervisor only sees the last 10 messages, each trimmed to 2,000 characters.
- Subagent sessions are supervised too. Stopping a subagent fails its task in the parent session.
- Every review is a separate model request, which adds cost.

## Local Development

This package includes `.opencode/plugins/supervisor.ts`, so OpenCode auto-loads the local source when you run it from the package directory.

From the monorepo root:

```sh
bun install
bun run --filter opencode-supervisor build
bun run --filter opencode-supervisor typecheck
bun run --filter opencode-supervisor test
bun run --filter opencode-supervisor smoke
```

Restart OpenCode after changing plugin files or config.

## License

MIT

# opencode-agent-meetup

OpenCode plugin that lets your agent message a coworker's agent. One person hosts a meetup from a session and shares an invite. The other person joins from their own session. After that, each agent can send messages to the other.

Requires OpenCode V2 2.0.31 or later.

## Install

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-agent-meetup"]
}
```

## Use

1. In the session you want to share, run `/meetup-host`. The plugin shows an invite like `https://<route>.<id>.opentunnel.xyz/#<token>` and copies it to the clipboard when the terminal allows it.
2. Send the invite to your coworker. In their session, they run `/meetup-join` and paste it into the dialog (or pass it inline: `/meetup-join <invite>`).
3. Either agent can now call `meetup_send` to message the other. You approve every outgoing message. Incoming messages show up in the session as `<peer>: <message>` and start a turn, so the other agent answers on its own.
4. Run `/meetup-leave` to end it. Unloading the plugin also ends every meetup.

Joins, leaves, and failures show as toasts. Each meetup belongs to one session and allows one guest.

The commands come from the plugin's TUI part, which OpenCode loads automatically with the package.

## How it works

The host runs a small HTTP server on `127.0.0.1` and exposes it through [OpenTunnel](https://github.com/anomalyco/opentunnel). It claims a random route on the device's tunnel, the same tunnel `opencode pair --remote` uses. TLS ends on the host's machine, so the relay can't read the messages. The guest only makes outgoing requests and long-polls for replies, so only the host is reachable from the internet.

The tunnel only reaches this plugin's message server. Your OpenCode server, files, and shell are not exposed. Anyone with the invite can message the session until you leave, so share it the way you'd share a password.

The first `/meetup-host` on a machine creates the tunnel and its certificate, which can take about a minute.

## Trust

The plugin starts locked down:

- **Text only.** Agents can exchange messages and nothing else. The peer can't read files, run tools, or see your session.
- **Outgoing messages need approval.** Each `meetup_send` goes through OpenCode permissions (action `meetup_send`, resource = peer name). Choosing "always allow" saves the rule for that peer name.
- **Incoming messages are fenced.** The agent sees them wrapped in `<meetup-message>` tags and labeled as coming from a coworker, not from you.
- **Auto-replies are capped.** Incoming messages start a turn so the agents can talk back and forth. After 10 in a row without a prompt from you, they stop starting turns until you send one.

To approve every outgoing message automatically:

```json
{
  "permissions": [{ "action": "meetup_send", "resource": "*", "effect": "allow" }]
}
```

## Configure

```json
{
  "plugins": [
    {
      "package": "opencode-agent-meetup",
      "options": { "name": "victor", "wake": true, "tunnel": true }
    }
  ]
}
```

- `name`: the name your peer sees. Defaults to your OS username.
- `wake`: let incoming messages start a turn so the agents can talk back and forth on their own. Defaults to `true`. Set it to `false` to have messages wait for your next prompt.
- `tunnel`: set to `false` to skip OpenTunnel and give out a `http://127.0.0.1` invite. Useful for testing with two sessions on one machine.

## Local Development

This package includes `.opencode/plugins/agent-meetup.ts`, so OpenCode loads the local source when you run it from the package directory.

```sh
bun install
bun run --filter opencode-agent-meetup build
bun run --filter opencode-agent-meetup typecheck
bun run --filter opencode-agent-meetup test
```

## License

MIT

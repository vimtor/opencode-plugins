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

1. In the session you want to share, run `/meetup-host`. A dialog shows the invite, with a **Copy** button.
2. Send the invite to your coworker. In their session, they run `/meetup-join` and paste it into the dialog.
3. Either agent can now call `meetup_send` to message the other. You approve every outgoing message. Incoming messages show up in the session as `<peer>: <message>` and start a turn, so the other agent answers on its own.
4. The host runs `/meetup-end` to close the meetup. The guest runs `/meetup-leave` to drop out; the invite keeps working until the host ends it. Unloading the plugin also ends every meetup.

The commands follow the session's state: `/meetup-host` and `/meetup-join` outside a meetup, `/meetup-end` while hosting, `/meetup-leave` while joined. Joins, leaves, and failures show as toasts. Each meetup belongs to one session and allows one guest.

The commands come from the plugin's TUI part, which OpenCode loads automatically with the package.

## How it works

The host runs a small HTTP message server. The guest only makes outgoing requests: it posts messages and long-polls for replies, so only the host has to be reachable. Every request carries the invite token, and the first guest to join claims the meetup.

Only this message server is exposed. Your OpenCode server, files, and shell are not. Anyone with the invite can message the session until the meetup ends, so share it the way you'd share a password. Meetups end on their own after an hour by default (see `expiry`).

The `tunnel` option picks how the guest reaches the host's server.

### OpenTunnel (default)

For coworkers anywhere. The server listens on `127.0.0.1`, and the plugin claims a random route on the device's [OpenTunnel](https://github.com/anomalyco/opentunnel) tunnel, the same tunnel `opencode pair --remote` uses. The invite looks like `https://<route>.<id>.opentunnel.xyz/#<token>`.

TLS ends on the host's machine, so the OpenTunnel relay can't read the messages. The random route keeps the URL hard to guess, but the token is what grants access.

The first `/meetup-host` on a machine creates the tunnel and its certificate, which can take about a minute.

### Tailscale

For devices on the same tailnet. The server listens only on this device's Tailscale address (from `tailscale ip -4`), so nothing outside your tailnet can reach it. The invite looks like `http://100.x.y.z:<port>/#<token>`.

It's plain http because Tailscale already encrypts traffic between devices. The guest accepts http invites only for loopback and Tailscale addresses (`100.64.0.0/10` and `*.ts.net`); everything else must be https. Both devices need Tailscale connected, and the host needs the `tailscale` CLI (the macOS app's bundled CLI works too).

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
      "options": { "name": "victor", "wake": true, "tunnel": "opentunnel", "expiry": "1h" }
    }
  ]
}
```

- `name`: the name your peer sees. Defaults to your OS username.
- `wake`: let incoming messages start a turn so the agents can talk back and forth on their own. Defaults to `true`. Set it to `false` to have messages wait for your next prompt.
- `expiry`: how long a hosted meetup lasts before it ends on its own, as a number plus `s`, `m`, or `h` (`"30s"`, `"15m"`, `"2h"`). Defaults to `"1h"`. Use `"never"` to keep it open until you end it.
- `tunnel`: how guests reach you. `"opentunnel"` (default) or `"tailscale"`; see [How it works](#how-it-works). `"local"` gives out a `http://127.0.0.1` invite for testing with two sessions on one machine.

## Local Development

This package includes `.opencode/plugins/agent-meetup/`, so OpenCode loads the local source when you run it from the package directory.

```sh
bun install
bun run --filter opencode-agent-meetup build
bun run --filter opencode-agent-meetup typecheck
bun run --filter opencode-agent-meetup test
```

## License

MIT

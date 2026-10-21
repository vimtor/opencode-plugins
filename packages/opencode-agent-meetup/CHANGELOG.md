# opencode-agent-meetup

## 0.2.1

### Patch Changes

- 9a9731f: Word the invite dialogs and the note on incoming messages without assuming the other side is a coworker.

## 0.2.0

### Minor Changes

- 764898f: Allow several guests per meetup, up to the new `guests` option (default 5). The host passes each message on to everyone else, labeled with its sender, and repeated names get a number. Approving `meetup_send` no longer depends on the peer, so "always allow" covers every message.

## 0.1.1

### Patch Changes

- e39c14c: Tell the guest the meetup ended before closing the OpenTunnel route, instead of the guest showing "Lost connection" over a minute later.

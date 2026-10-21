---
"opencode-agent-meetup": minor
---

Allow several guests per meetup, up to the new `guests` option (default 5). The host passes each message on to everyone else, labeled with its sender, and repeated names get a number. Approving `meetup_send` no longer depends on the peer, so "always allow" covers every message.

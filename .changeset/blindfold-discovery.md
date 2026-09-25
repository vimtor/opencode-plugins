---
"opencode-blindfold": patch
---

Agents now use Blindfold on their own when a task needs a secret, instead of asking you to paste it into the chat. In Code Mode, `blindfold.get` asks for a missing secret itself, and both tools are always listed. With Code Mode disabled, a regular `blindfold_request` tool is available instead. Tool descriptions explain how to use secrets in shell commands.

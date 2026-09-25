---
"opencode-blindfold": minor
---

Agents now use Blindfold on their own when a task needs a secret, instead of asking you to paste it into the chat. There's now a single `blindfold.get` tool that asks for a missing secret itself: in Code Mode it returns the value to the running code only, and with Code Mode disabled it's a regular tool that stores the secret without returning it. The separate `blindfold_request` tool is removed. Tool descriptions explain how to use secrets in shell commands. The `prompt.timeout` option is removed; the dialog waits a fixed 10 minutes.

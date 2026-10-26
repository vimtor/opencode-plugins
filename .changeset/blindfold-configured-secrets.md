---
"opencode-blindfold": minor
---

Add a `secrets` option to configure secrets ahead of time, so agents can use them without a dialog. Values starting with `op://` are read from 1Password; any other value is the secret itself, and works with `{env:NAME}`.

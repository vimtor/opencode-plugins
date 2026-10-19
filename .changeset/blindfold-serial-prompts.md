---
"opencode-blindfold": patch
---

Ask for secrets one dialog at a time, so concurrent `blindfold.get` calls no longer close each other's prompt.

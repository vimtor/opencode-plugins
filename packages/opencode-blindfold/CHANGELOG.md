# opencode-blindfold

## 0.5.0

### Minor Changes

- 5ff1735: Add OpenCode Desktop support: Desktop asks for requested secrets in a dialog that hides what you type, and closes it when another client answers.

## 0.4.1

### Patch Changes

- 77d3277: Rename the `onepassword` option to `1password`, e.g. `"1password": { "account": "acme.1password.com" }`.

## 0.4.0

### Minor Changes

- 794c968: Read `op://` secrets when signed in to several 1Password accounts. blindfold falls back to `my.1password.com`, or uses the account set in the new `onepassword.account` option.

## 0.3.0

### Minor Changes

- d7b774b: Add a `secrets` option to configure secrets ahead of time, so agents can use them without a dialog. Values starting with `op://` are read from 1Password; any other value is the secret itself, and works with `{env:NAME}`.

## 0.2.2

### Patch Changes

- 9d3ad13: Ask for secrets one dialog at a time, so concurrent `blindfold.get` calls no longer close each other's prompt.

## 0.2.1

### Patch Changes

- aef9187: Tell the agent that printed secrets are redacted instead of forbidding printing them.

## 0.2.0

### Minor Changes

- 1ab6320: Agents now use Blindfold on their own when a task needs a secret, instead of asking you to paste it into the chat. There's now a single `blindfold.get` tool that asks for a missing secret itself: in Code Mode it returns the value to the running code only, and with Code Mode disabled it's a regular tool that stores the secret without returning it. The separate `blindfold_request` tool is removed. Tool descriptions explain how to use secrets in shell commands. The `prompt.timeout` option is removed; the dialog waits a fixed 10 minutes.

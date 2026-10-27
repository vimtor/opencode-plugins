# opencode-quick-quote

## 0.3.0

### Minor Changes

- 5ff1735: Add OpenCode Desktop support: `/quote` picks a paragraph from the last reply and attaches it to the prompt as a quote; add words after `/quote` to filter. List the plugin in the global `opencode.json` to use it in both.

## 0.2.0

### Minor Changes

- c1cf0a3: Fix the quote popup being unreadable in light themes and showing the transcript through it. The popup now uses the raised surface color with a full border. Requires OpenCode 2.0.28 or newer.

## 0.1.2

### Patch Changes

- f825f30: Match accented letters when searching with plain ASCII: fold diacritics with NFKD normalization so e.g. `spocitaj` finds "Spočítaj" and `na` finds "Návrh".

## 0.1.1

### Patch Changes

- d790bb3: Keep assistant replies to the same user prompt quotable together, including follow-ups after background notifications.

# opencode-quick-quote

## 0.2.0

### Minor Changes

- c1cf0a3: Fix the quote popup being unreadable in light themes and showing the transcript through it. The popup now uses the raised surface color with a full border. Requires OpenCode 2.0.28 or newer.

## 0.1.2

### Patch Changes

- f825f30: Match accented letters when searching with plain ASCII: fold diacritics with NFKD normalization so e.g. `spocitaj` finds "Spočítaj" and `na` finds "Návrh".

## 0.1.1

### Patch Changes

- d790bb3: Keep assistant replies to the same user prompt quotable together, including follow-ups after background notifications.

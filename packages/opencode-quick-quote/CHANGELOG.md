# opencode-quick-quote

## 0.1.2

### Patch Changes

- f825f30: Match accented letters when searching with plain ASCII: fold diacritics with NFKD normalization so e.g. `spocitaj` finds "Spočítaj" and `na` finds "Návrh".

## 0.1.1

### Patch Changes

- d790bb3: Keep assistant replies to the same user prompt quotable together, including follow-ups after background notifications.

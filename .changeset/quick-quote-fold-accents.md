---
"opencode-quick-quote": patch
---

Match accented letters when searching with plain ASCII: fold diacritics with NFKD normalization so e.g. `spocitaj` finds "Spočítaj" and `na` finds "Návrh".

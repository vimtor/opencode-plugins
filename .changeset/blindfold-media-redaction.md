---
"opencode-blindfold": patch
---

Leave base64 data URLs and inline media (images, audio, video, PDFs) byte-exact during redaction, so provider requests no longer fail with "Invalid base64 data". Provider JSON is redacted one string literal at a time, so number precision, whitespace, key order, and the escaping of unchanged strings are preserved. Redaction also handles lone surrogates, `__proto__` keys, wrapped base64, and long encoded secrets, and pending secret prompts are released when the plugin unloads or the tool call is cancelled.

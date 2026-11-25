---
"opencode-blindfold": patch
---

Leave base64 data URLs and inline media (images, audio, video, PDFs) byte-exact during redaction, so provider requests no longer fail with "Invalid base64 data". Provider bodies are now redacted as structured JSON where possible instead of a raw text rewrite, which keeps JSON escapes, content length, compressed bodies, and repeated redaction intact. Redaction also handles lone surrogates, `__proto__` keys, and long encoded secrets, and pending secret prompts are released when the plugin unloads or the tool call is cancelled.

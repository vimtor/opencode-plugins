// OBS-safe wrapper: run a command while redacting secret values and common
// encodings from live stdout/stderr output.
//
// Usage (PowerShell):
//   $env:BLINDFOLD_SECRETS_FILE = "C:\...\secrets.env"
//   node scripts/redact-live.mjs -- ffmpeg ...
//
// secrets.env format:
//   GITHUB_TOKEN=ghp_xxx
//   NPM_TOKEN=npm_xxx
// Lines beginning with # are ignored. Values are read only by this process.

import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

const secretFile = process.env.BLINDFOLD_SECRETS_FILE
const args = process.argv.slice(2)
const sep = args.indexOf("--")
const command = sep >= 0 ? args.slice(sep + 1).join(" ") : args.join(" ")
if (!command) {
  console.error("Usage: node scripts/redact-live.mjs -- <command>")
  process.exit(2)
}

function parseEnvFile(file) {
  const out = new Map()
  if (!file) return out
  const text = readFileSync(file, "utf8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const name = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (name && value) out.set(name, value)
  }
  return out
}

function encodings(value) {
  const bytes = Buffer.from(value)
  return [
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    bytes.toString("base64").replace(/=+$/, ""),
    bytes.toString("base64url"),
    bytes.toString("hex"),
  ]
}

const secrets = parseEnvFile(secretFile)
const needles = []
for (const [name, value] of secrets) {
  for (const text of encodings(value)) {
    if (text.length >= 8) needles.push({ text, replacement: `[REDACTED:${name}]` })
  }
  if (value.length < 8) needles.push({ text: value, replacement: `[REDACTED:${name}]` })
}
needles.sort((a, b) => b.text.length - a.text.length)

function redactChunk(chunk) {
  let text = chunk.toString("utf8")
  for (const needle of needles) {
    if (text.includes(needle.text)) text = text.split(needle.text).join(needle.replacement)
  }
  return Buffer.from(text, "utf8")
}

const env = { ...process.env }
for (const [name, value] of secrets) {
  const mentioned = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(command)
  if (mentioned) env[name] = value
}

const child = spawn(command, { shell: true, env, stdio: ["inherit", "pipe", "pipe"] })

child.stdout.on("data", (chunk) => process.stdout.write(redactChunk(chunk)))
child.stderr.on("data", (chunk) => process.stderr.write(redactChunk(chunk)))
child.on("close", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})

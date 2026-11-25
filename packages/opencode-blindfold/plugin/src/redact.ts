// Shorter encodings are too likely to match unrelated output, such as short hex runs.
const MIN_ENCODED_LENGTH = 8

// A base64 data URL carries binary data. Changing one character breaks the image,
// audio/video file, or PDF, so redaction leaves the whole URL alone.
// JSON bodies may escape "/" and some characters as \uXXXX, which is kept too.
const DATA_URL = /data:[^,\r\n]{0,1024};base64,(?:[A-Za-z0-9+/=_-]|\\\/|\\u[0-9A-Fa-f]{4}|%[0-9A-Fa-f]{2})*/gi

// Bodies above this size are not parsed again. The context hook already redacts
// the messages a provider request is built from.
const MAX_BODY_BYTES = 64 * 1024 * 1024

// Common encodings an agent might produce without meaning to reveal the value.
function urlEncoding(value: string) {
  try {
    return encodeURIComponent(value)
  } catch {
    // A lone surrogate is not valid Unicode, so it cannot be URI encoded.
    return undefined
  }
}

function encodings(value: string) {
  const bytes = Buffer.from(value)
  const base64 = bytes.toString("base64")
  const json = JSON.stringify(value).slice(1, -1)
  return [
    json,
    json.replaceAll("/", "\\/"),
    urlEncoding(value),
    base64,
    base64.replace(/=+$/, ""),
    bytes.toString("base64url"),
    bytes.toString("hex"),
  ].filter((text): text is string => text !== undefined)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isMediaType(value: string) {
  return /^(?:image|audio|video)\//i.test(value) || /^application\/(?:pdf|octet-stream)\b/i.test(value)
}

// Long base64 without a data: prefix, as some assets and providers serialize inline media.
function isBareBase64(value: string) {
  return value.length >= 64 && /^[A-Za-z0-9+/_=\r\n-]+$/.test(value)
}

// OpenCode stores inline media as data URLs, but assets and some providers use a
// bare base64 field. Changing either makes the payload undecodable.
function binaryField(input: Record<string, unknown>) {
  // OpenCode's asset source says the field is base64, whatever the media type.
  if ((input.type === "base64" || input.type === "bytes") && typeof input.data === "string") return "data"
  const mediaType = input.mediaType ?? input.mime ?? input.mimeType
  if (typeof mediaType !== "string" || !isMediaType(mediaType)) return undefined
  if (typeof input.data === "string" && isBareBase64(input.data)) return "data"
  if (typeof input.uri === "string" && (input.uri.startsWith("data:") || isBareBase64(input.uri))) return "uri"
  return undefined
}

export function replacement(name: string) {
  return `[REDACTED:${name}]`
}

export class Redactor {
  #secrets = new Map<string, string>()
  #matcher: RegExp | undefined
  #markers = new Set<string>()
  #replacements = new Map<string, string>()

  get size() {
    return this.#secrets.size
  }

  names() {
    return [...this.#secrets.keys()]
  }

  entries() {
    return [...this.#secrets.entries()]
  }

  get(name: string) {
    return this.#secrets.get(name)
  }

  set(name: string, value: string) {
    if (value === "") throw new Error("Secrets must not be empty")
    this.#secrets.set(name, value)
    this.#rebuild()
  }

  delete(name: string) {
    const deleted = this.#secrets.delete(name)
    if (deleted) this.#rebuild()
    return deleted
  }

  text(input: string) {
    if (!this.#matcher) return input
    let output = ""
    let start = 0
    DATA_URL.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = DATA_URL.exec(input))) {
      output += this.#redactSegment(input.slice(start, match.index))
      output += match[0]
      start = match.index + match[0].length
    }
    return start === 0 ? this.#redactSegment(input) : output + this.#redactSegment(input.slice(start))
  }

  /** Redacts strings nested in plain objects and arrays, preserving references when nothing changes. */
  value<T>(input: T): T {
    if (this.#matcher === undefined) return input
    return this.#walk(input) as T
  }

  #redactSegment(input: string) {
    if (!this.#matcher) return input
    return input.replace(this.#matcher, (match) =>
      this.#markers.has(match) ? match : this.#replacements.get(match) ?? match,
    )
  }

  #walk(input: unknown): unknown {
    if (typeof input === "string") return this.text(input)
    if (Array.isArray(input)) {
      let changed = false
      const output = input.map((item) => {
        const next = this.#walk(item)
        if (next !== item) changed = true
        return next
      })
      return changed ? output : input
    }
    if (isPlainObject(input)) {
      let changed = false
      const binary = binaryField(input)
      const output: Record<string, unknown> = Object.create(Object.getPrototypeOf(input))
      for (const [key, item] of Object.entries(input)) {
        const next = key === binary ? item : this.#walk(item)
        if (next !== item) changed = true
        // defineProperty keeps a "__proto__" key as data instead of changing the prototype.
        Object.defineProperty(output, key, { value: next, enumerable: true, configurable: true, writable: true })
      }
      return changed ? output : input
    }
    return input
  }

  #rebuild() {
    const needles = new Map<string, string>()
    const markers: string[] = []
    for (const [name, value] of this.#secrets) {
      markers.push(replacement(name))
      if (!needles.has(value)) needles.set(value, replacement(name))
      for (const text of encodings(value)) {
        if (text.length >= MIN_ENCODED_LENGTH && !needles.has(text)) needles.set(text, replacement(name))
      }
    }
    this.#markers = new Set(markers)
    this.#replacements = needles
    // Markers are protected before needles so redacting already-redacted text,
    // or a secret that is part of the marker, cannot rewrite the marker.
    const pattern = [
      ...markers.sort((a, b) => b.length - a.length),
      ...[...needles.keys()].sort((a, b) => b.length - a.length),
    ].map(escapeRegExp)
    this.#matcher = pattern.length > 0 ? new RegExp(pattern.join("|"), "g") : undefined
  }
}

function isJsonType(type: string) {
  return type === "application/json" || type === "text/json" || type.endsWith("+json")
}

function hasBinaryControl(body: string) {
  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
  }
  return false
}

/**
 * Redacts a provider request body without breaking its encoding.
 * JSON is parsed and walked, so replacements are escaped by the serializer.
 * Compressed and binary bodies are left untouched.
 */
export async function redactRequest(redactor: Redactor, request: Request): Promise<Request | undefined> {
  if (redactor.size === 0 || request.body === null) return
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase()
  if (encoding !== undefined && encoding !== "" && encoding !== "identity") return
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  const json = isJsonType(type)
  const text = type === "" || type.startsWith("text/")
  if (!json && !text) return
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await request.clone().arrayBuffer())
  } catch {
    return
  }
  if (bytes.byteLength > MAX_BODY_BYTES || bytes.includes(0)) return

  let body: string
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return
  }

  let next: string | undefined
  let parsed: unknown
  let validJson = false
  try {
    parsed = JSON.parse(body)
    validJson = true
  } catch {
    // Fall through. A declared JSON body that does not parse is left alone,
    // because a text rewrite could corrupt its escapes.
  }

  if (validJson) {
    const redacted = redactor.value(parsed)
    if (redacted === parsed) return
    next = JSON.stringify(redacted)
  } else if (!json && type !== "" && !hasBinaryControl(body)) {
    next = redactor.text(body)
  } else {
    return
  }

  if (next === undefined || next === body) return
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  try {
    return new Request(request, { body: next, headers })
  } catch {
    return
  }
}

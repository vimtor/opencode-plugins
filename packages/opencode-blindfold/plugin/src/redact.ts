// Shorter encodings are too likely to match unrelated output, such as short hex runs.
const MIN_ENCODED_LENGTH = 8

// A base64 data URL carries binary data. Changing one character breaks the image,
// audio/video file, or PDF, so redaction leaves the whole URL alone.
const DATA_URL_START = /data:/gi

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

function isBase64Code(code: number) {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f ||
    code === 0x3d ||
    code === 0x5f ||
    code === 0x2d
  )
}

function isHexCode(code: number) {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66)
}

// A line break inside a wrapped data URL, including its JSON-escaped form.
function lineBreakLength(input: string, index: number) {
  const code = input.charCodeAt(index)
  if (code === 0x0a) return 1
  if (code === 0x0d) return input.charCodeAt(index + 1) === 0x0a ? 2 : 1
  if (code !== 0x5c) return 0
  const next = input.charCodeAt(index + 1)
  if (next === 0x6e) return 2
  if (next !== 0x72) return 0
  if (input.charCodeAt(index + 2) === 0x5c && input.charCodeAt(index + 3) === 0x6e) return 4
  return 2
}

// End of a continuation line that looks like wrapped base64 rather than "key=value" text.
function continuationEnd(input: string, start: number) {
  let index = start
  let padding = 0
  while (index < input.length) {
    if (lineBreakLength(input, index) > 0) break
    const code = input.charCodeAt(index)
    if (isBase64Code(code)) {
      if (code === 0x3d) {
        if (padding === 2) return -1
        padding++
      } else if (padding > 0) {
        // "=" is only padding at the end of a base64 line. An internal "=" means
        // this is ordinary text such as "token=value", not a payload continuation.
        return -1
      }
      index++
      continue
    }
    if (code === 0x25 && isHexCode(input.charCodeAt(index + 1)) && isHexCode(input.charCodeAt(index + 2))) {
      index += 3
      continue
    }
    if (code === 0x5c && input.charCodeAt(index + 1) === 0x2f) {
      index += 2
      continue
    }
    if (
      code === 0x5c &&
      input.charCodeAt(index + 1) === 0x75 &&
      isHexCode(input.charCodeAt(index + 2)) &&
      isHexCode(input.charCodeAt(index + 3)) &&
      isHexCode(input.charCodeAt(index + 4)) &&
      isHexCode(input.charCodeAt(index + 5))
    ) {
      index += 6
      continue
    }
    break
  }
  return index === start ? -1 : index
}

// End of a base64 data URL, or -1 when the text at start is not one.
function dataUrlEnd(input: string, start: number) {
  const headerLimit = Math.min(input.length, start + 1024)
  let comma = start + 5
  while (comma < headerLimit) {
    const code = input.charCodeAt(comma)
    if (code === 0x2c) break
    if (code === 0x0a || code === 0x0d || code === 0x22) return -1
    comma++
  }
  if (comma >= input.length || input.charCodeAt(comma) !== 0x2c) return -1
  if (!input.slice(start, comma).toLowerCase().endsWith(";base64")) return -1

  let index = comma + 1
  while (index < input.length) {
    const code = input.charCodeAt(index)
    if (isBase64Code(code)) {
      index++
      continue
    }
    if (code === 0x25 && isHexCode(input.charCodeAt(index + 1)) && isHexCode(input.charCodeAt(index + 2))) {
      index += 3
      continue
    }
    if (code === 0x5c && input.charCodeAt(index + 1) === 0x2f) {
      index += 2
      continue
    }
    if (
      code === 0x5c &&
      input.charCodeAt(index + 1) === 0x75 &&
      isHexCode(input.charCodeAt(index + 2)) &&
      isHexCode(input.charCodeAt(index + 3)) &&
      isHexCode(input.charCodeAt(index + 4)) &&
      isHexCode(input.charCodeAt(index + 5))
    ) {
      index += 6
      continue
    }
    const lineBreak = lineBreakLength(input, index)
    if (lineBreak > 0) {
      const next = continuationEnd(input, index + lineBreak)
      if (next < 0) return index
      index = next
      continue
    }
    return index
  }
  return index
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
    DATA_URL_START.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = DATA_URL_START.exec(input))) {
      const end = dataUrlEnd(input, match.index)
      if (end < 0) {
        DATA_URL_START.lastIndex = match.index + 1
        continue
      }
      output += this.#redactSegment(input.slice(start, match.index))
      output += input.slice(match.index, end)
      start = end
      DATA_URL_START.lastIndex = end
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

const JSON_STRING = /"(?:[^"\\]|\\.)*"/g

function isObjectKey(input: string, end: number) {
  let index = end
  while (index < input.length) {
    const code = input.charCodeAt(index)
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      index++
      continue
    }
    return code === 0x3a
  }
  return false
}

// Replaces only the string literals that changed. Numbers, whitespace, key order,
// and the escaping of every other literal stay byte-for-byte intact.
function redactJson(redactor: Redactor, body: string) {
  let output = ""
  let start = 0
  let changed = false
  JSON_STRING.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = JSON_STRING.exec(body))) {
    if (isObjectKey(body, match.index + match[0].length)) continue
    let value: string
    try {
      value = JSON.parse(match[0])
    } catch {
      continue
    }
    const redacted = redactor.text(value)
    if (redacted === value) continue
    output += body.slice(start, match.index) + JSON.stringify(redacted)
    start = match.index + match[0].length
    changed = true
  }
  return changed ? output + body.slice(start) : undefined
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
 * JSON is validated, then only changed string literals are re-serialized, so the
 * rest of the body keeps its exact bytes. Compressed and binary bodies are left untouched.
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
  let validJson = false
  try {
    JSON.parse(body)
    validJson = true
  } catch {
    // Fall through. A declared JSON body that does not parse is left alone,
    // because a text rewrite could corrupt its escapes.
  }

  if (validJson) {
    next = redactJson(redactor, body)
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

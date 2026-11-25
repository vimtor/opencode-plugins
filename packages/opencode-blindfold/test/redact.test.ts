import { expect, test } from "bun:test"
import { Redactor, replacement } from "../plugin/src/redact.js"

const MEDIA = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("a screenshot with a secret in it"),
]).toString("base64")

test("leaves image, audio, video, and PDF data URLs byte-exact", () => {
  const redactor = new Redactor()
  const secret = MEDIA.slice(16, 24)
  redactor.set("TOKEN", secret)

  for (const mime of ["image/png", "image/jpeg", "audio/wav", "video/mp4", "application/pdf"]) {
    const url = `data:${mime};base64,${MEDIA}`
    const input = `before ${url} after ${secret}`
    expect(redactor.text(input)).toBe(`before ${url} after ${replacement("TOKEN")}`)
  }
})

test("leaves encoded secrets inside data URLs untouched", () => {
  const redactor = new Redactor()
  const value = 'p@ss "word"/1234'
  redactor.set("PASSWORD", value)
  const bytes = Buffer.from(value)
  const encodings = [
    encodeURIComponent(value),
    bytes.toString("base64"),
    bytes.toString("base64url"),
    bytes.toString("hex"),
    bytes.toString("base64").replace(/=+$/, ""),
  ]

  for (const encoded of encodings) {
    const url = `data:application/octet-stream;base64,${encoded}`
    expect(redactor.text(url)).toBe(url)
  }
  expect(redactor.text(value)).toBe(replacement("PASSWORD"))
})

test("handles JSON-escaped slashes in a data URL", () => {
  const redactor = new Redactor()
  redactor.set("SLASH", "\\/")
  const url = `data:image/jpeg;base64,${Buffer.from([0xff, 0xff, 0xff]).toString("base64")}`
  const escaped = JSON.stringify({ uri: url }).replaceAll("/", "\\/")
  expect(redactor.text(`${escaped} token=\\/`)).toBe(`${escaped} token=${replacement("SLASH")}`)
})

test("redacts JSON-escaped slashes in plain text", () => {
  const redactor = new Redactor()
  const value = 'p@ss "word"/1234'
  redactor.set("PASSWORD", value)
  const escaped = JSON.stringify(value).slice(1, -1).replaceAll("/", "\\/")
  expect(redactor.text(`before ${escaped} after`)).toBe(`before ${replacement("PASSWORD")} after`)
})

test("leaves bare base64 media fields untouched", () => {
  const redactor = new Redactor()
  redactor.set("CHUNK", "AAAA")
  const data = `AAAA${"A".repeat(100)}`
  const asset = redactor.value({ type: "base64", mediaType: "image/png", data, label: "AAAA" })
  expect(asset.data).toBe(data)
  expect(asset.label).toBe(replacement("CHUNK"))

  const nested = redactor.value({ source: { type: "bytes", mediaType: "application/pdf", data } })
  expect(nested.source.data).toBe(data)

  const anthropic = redactor.value({ type: "base64", media_type: "image/gif", data, label: "AAAA" })
  expect(anthropic.data).toBe(data)
  expect(anthropic.label).toBe(replacement("CHUNK"))

  const gemini = redactor.value({ inlineData: { mimeType: "image/png", data }, label: "AAAA" })
  expect(gemini.inlineData.data).toBe(data)

  const bedrock = redactor.value({ source: { bytes: data }, label: "AAAA" })
  expect(bedrock.source.bytes).toBe(data)
  expect(bedrock.label).toBe(replacement("CHUNK"))

  const bareData = redactor.value({ data, label: "AAAA" })
  expect(bareData.data).toBe(data)
  expect(bareData.label).toBe(replacement("CHUNK"))

  const short = "R0lGODlhAQABAAAAACw="
  const shortAnthropic = redactor.value({ type: "base64", media_type: "image/gif", data: short, label: "AAAA" })
  expect(shortAnthropic.data).toBe(short)
  expect(shortAnthropic.label).toBe(replacement("CHUNK"))
  const shortGemini = redactor.value({ inlineData: { mimeType: "image/gif", data: short }, label: "AAAA" })
  expect(shortGemini.inlineData.data).toBe(short)
  const shortBedrock = redactor.value({ source: { bytes: short }, label: "AAAA" })
  expect(shortBedrock.source.bytes).toBe(short)

  const both = redactor.value({ data, bytes: data })
  expect(both.data).toBe(data)
  expect(both.bytes).toBe(data)

  const file = redactor.value({ type: "file", mime: "image/jpeg", uri: data })
  expect(file.uri).toBe(data)

  const url = redactor.value({ type: "file", mime: "image/png", uri: "https://example.com/?token=AAAA" })
  expect(url.uri).toBe(`https://example.com/?token=${replacement("CHUNK")}`)
})

test("redacts plain text in data and bytes fields that are not base64", () => {
  const redactor = new Redactor()
  redactor.set("DATA", "secret-value")
  const input = { data: "secret-value", bytes: "secret-value" }
  const output = redactor.value(input)
  expect(output.data).toBe(replacement("DATA"))
  expect(output.bytes).toBe(replacement("DATA"))
})

test("keeps a __proto__ key as data", () => {
  const redactor = new Redactor()
  redactor.set("TOKEN", "secret-value")
  const input = JSON.parse('{"__proto__":{"value":"secret-value"}}')
  const output = redactor.value(input) as Record<string, unknown>
  expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
  expect(Object.prototype.hasOwnProperty.call(output, "__proto__")).toBe(true)
  expect(JSON.stringify(output)).toBe('{"__proto__":{"value":"[REDACTED:TOKEN]"}}')
})

test("leaves wrapped base64 data URLs untouched", () => {
  const redactor = new Redactor()
  redactor.set("CHUNK", "AAAA")
  redactor.set("TOKEN", "BBBB")
  const line = "A".repeat(76)
  const padded = `${"A".repeat(74)}==`
  const urls = [
    `data:image/png;base64,QUJD\n${line}`,
    `data:image/png;base64,QUJD\r\n${line}`,
    `data:image/png;base64,QUJD\n${line}\n${padded}`,
    `data:image/png;base64,QUJD\\n${line}`,
    `data:image/png;base64,QUJD\\r\\n${line}`,
    `data:image/png;base64,QUJD\n${"A".repeat(64)}`,
  ]
  for (const url of urls) expect(redactor.text(url)).toBe(url)

  expect(redactor.text(`data:image/png;base64,QUJD\n${line}\ntoken=BBBB`)).toBe(
    `data:image/png;base64,QUJD\n${line}\ntoken=${replacement("TOKEN")}`,
  )
})

test("does not treat ordinary text after a data URL as wrapped base64", () => {
  const secret = new Redactor()
  secret.set("TOKEN", "secret")
  expect(secret.text("data:image/png;base64,QUJD\nsecret: value")).toBe(
    `data:image/png;base64,QUJD\n${replacement("TOKEN")}: value`,
  )

  const token = new Redactor()
  token.set("TOKEN", "token")
  expect(token.text("data:image/png;base64,QUJD\ntoken value")).toBe(
    `data:image/png;base64,QUJD\n${replacement("TOKEN")} value`,
  )

  const short = new Redactor()
  short.set("TOKEN", "BBBB")
  expect(short.text("data:image/png;base64,QUJD\nBBBB, next")).toBe(
    `data:image/png;base64,QUJD\n${replacement("TOKEN")}, next`,
  )

  const long = new Redactor()
  long.set("TOKEN", "AAAA")
  const twenty = "A".repeat(20)
  expect(long.text(`data:image/png;base64,QUJD\n${twenty}: value`)).toBe(
    `data:image/png;base64,QUJD\n${"[REDACTED:TOKEN]".repeat(5)}: value`,
  )
})

test("redacts text after a data URL but not the URL itself", () => {
  const redactor = new Redactor()
  redactor.set("TOKEN", "s3cret-value")
  const url = `data:image/png;base64,${MEDIA}`
  expect(redactor.text(`${url}\ntoken=s3cret-value`)).toBe(`${url}\ntoken=${replacement("TOKEN")}`)
})

test("remains idempotent when a secret is part of the replacement marker", () => {
  const redactor = new Redactor()
  redactor.set("TOKEN", "TOKEN")
  const once = redactor.text("TOKEN")
  expect(once).toBe(replacement("TOKEN"))
  expect(redactor.text(once)).toBe(once)
  expect(redactor.text(`x ${once} y`)).toBe(`x ${once} y`)

  const markerWord = new Redactor()
  markerWord.set("MARKER", "REDACTED")
  const marked = markerWord.text("REDACTED")
  expect(marked).toBe(replacement("MARKER"))
  expect(markerWord.text(marked)).toBe(marked)
})

test("redacts one-character secrets in text and skips data URLs", () => {
  const redactor = new Redactor()
  redactor.set("CHAR", "Z")
  const payload = `AAAA${Buffer.from("ZZZ").toString("base64")}`
  const url = `data:image/png;base64,${payload}`
  expect(redactor.text(url)).toBe(url)
  expect(redactor.text("Z")).toBe(replacement("CHAR"))
})

test("handles Unicode and lone surrogates without throwing", () => {
  const redactor = new Redactor()
  const value = "🔑 ключ"
  redactor.set("UNICODE", value)
  expect(redactor.text(value)).toBe(replacement("UNICODE"))
  expect(redactor.text(Buffer.from(value).toString("base64"))).toBe(replacement("UNICODE"))
  expect(redactor.text(encodeURIComponent(value))).toBe(replacement("UNICODE"))

  expect(() => redactor.set("BROKEN", "\ud800")).not.toThrow()
  expect(redactor.text("\ud800")).toBe(replacement("BROKEN"))
})

test("rejects empty values and cleans up after a delete", () => {
  const redactor = new Redactor()
  expect(() => redactor.set("EMPTY", "")).toThrow("Secrets must not be empty")

  redactor.set("TOKEN", "secret-value")
  expect(redactor.delete("TOKEN")).toBe(true)
  expect(redactor.text("secret-value")).toBe("secret-value")
  const untouched = { text: "secret-value" }
  expect(redactor.value(untouched)).toBe(untouched)
})

test("keeps unchanged nested references", () => {
  const redactor = new Redactor()
  redactor.set("TOKEN", "secret-value")
  const untouched = { text: "hello" }
  const input = { content: "hello", metadata: { untouched } }
  expect(redactor.value(input)).toBe(input)
})

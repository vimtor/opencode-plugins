import { expect, mock, test } from "bun:test"
import { gzipSync } from "node:zlib"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"

type OpError = Error & { code?: string; killed?: boolean }
type OpReply = { error?: OpError; stdout?: string; stderr?: string }

const opCalls: string[][] = []
const opOptions: unknown[] = []
let opReply = (_args: string[]): OpReply => ({})

// Tests run on Windows too, where a fake "op" shell script cannot be executed
// with execFile. Mocking the call keeps the 1Password paths testable everywhere.
mock.module("node:child_process", () => ({
  execFile: (file: string, args: string[], options: unknown, callback: (error: OpError | null, stdout: string, stderr: string) => void) => {
    opCalls.push([file, ...args])
    opOptions.push(options)
    queueMicrotask(() => {
      const reply = opReply(args)
      callback(reply.error ?? null, reply.stdout ?? "", reply.stderr ?? "")
    })
    return {}
  },
}))

const blindfold = (await import("opencode-blindfold")).default

const SECRET = "sk-test-1234567890"
const context = {
  sessionID: "ses_test", agent: "build", messageID: "msg_test", id: "call_test",
  progress: async () => {},
} as unknown as ToolContext

type Handler = (input: unknown) => Promise<unknown>
type Hook = (event: any) => unknown

async function harness(options: Record<string, unknown> = {}) {
  const tools = new Map<string, Info>()
  const hooks = new Map<string, Hook>()
  const emitted: Array<[string, Record<string, unknown>]> = []
  let handlers!: Record<string, Handler>
  let unreachable = false
  const cleanup = await blindfold.setup({
    options,
    rpc: {
      register: async (_: unknown, value: Record<string, Handler>) => {
        handlers = value
        return { dispose: async () => {}, events: { emit: async (name: string, data: Record<string, unknown>) => {
          if (unreachable && name === "requested") throw new Error("no subscribers")
          emitted.push([name, data])
        } } }
      },
    },
    tool: {
      transform: async (transform: (editor: Pick<ToolEditor, "add" | "namespace">) => void) =>
        transform({ namespace: () => {}, add: (tool: Info) => { tools.set(tool.name, tool) } }),
      hook: async (name: string, hook: Hook) => { hooks.set(`tool.${name}`, hook) },
    },
    session: { hook: async (name: string, hook: Hook) => { hooks.set(`session.${name}`, hook) } },
    shell: { hook: async (name: string, hook: Hook) => { hooks.set(`shell.${name}`, hook) } },
    permission: { hook: async (name: string, hook: Hook) => { hooks.set(`permission.${name}`, hook) } },
  } as unknown as Plugin.Context)

  async function store(value = SECRET, name = "API_TOKEN") {
    const result = tools.get("get")!.execute({ name, reason: "Call the API" }, context)
    await Bun.sleep(0)
    const [, data] = emitted.filter(([event]) => event === "requested").at(-1)!
    await handlers.submit({ requestID: data.requestID, value })
    return result
  }

  return { tools, hooks, emitted, handlers: () => handlers, store, cleanup, unreachable: () => { unreachable = true } }
}

test("registers a single get tool, in Code Mode when enabled", async () => {
  const { tools } = await harness()
  expect([...tools.keys()]).toEqual(["get"])
  const get = tools.get("get")!
  expect(get.options).toEqual({ namespace: "blindfold", codemode: true, pinned: true })
  expect(get.description).toContain("the user is asked to enter it privately")
  expect(get.description).toContain("running code only")
  expect(get.description).toContain('GH_TOKEN="$GITHUB_TOKEN"')
  expect(get.description).toContain("The user must approve each such command.")
})

test("as a regular tool, get stores the secret without returning it", async () => {
  const { tools, emitted, store } = await harness({ codemode: { enabled: false } })
  expect([...tools.keys()]).toEqual(["get"])
  expect(tools.get("get")!.options).toEqual({ namespace: "blindfold", codemode: false })
  expect(tools.get("get")!.description).toContain("never returned to you")
  const result = await store()
  expect(emitted[0]).toEqual(["requested", expect.objectContaining({ sessionID: "ses_test", name: "API_TOKEN", reason: "Call the API" })])
  expect(emitted[1]).toEqual(["resolved", { requestID: emitted[0][1].requestID }])
  expect(result.content).toBe("Secret API_TOKEN is stored. Blindfold secrets available: API_TOKEN.")
})

test("adds the same system instruction before and after secrets are stored", async () => {
  const system = async (hooks: Map<string, Hook>) => {
    const request = { system: [] as Array<{ type: string; text: string }>, messages: [] }
    await hooks.get("session.context")!(request)
    expect(request.system).toHaveLength(1)
    return request.system[0].text
  }
  const { hooks, store } = await harness()
  const before = await system(hooks)
  expect(before).toContain("tools.blindfold.get({ name, reason })")
  expect(before).toContain("Never ask the user to paste secrets")
  expect(before).toContain("you won't see them even if you print them")
  await store()
  expect(await system(hooks)).toBe(before)

  const direct = await harness({ codemode: { enabled: false } })
  expect(await system(direct.hooks)).toContain("the `blindfold_get` tool")
})

test("get asks the user for a missing secret from Code Mode", async () => {
  const { tools, emitted, handlers } = await harness()
  const value = tools.get("get")!.execute({ name: "API_TOKEN", reason: "Call the API" }, context)
  await Bun.sleep(0)
  const [, data] = emitted[0]
  expect(data).toMatchObject({ name: "API_TOKEN", reason: "Call the API" })
  await handlers().submit({ requestID: data.requestID, value: SECRET })
  expect(await value).toEqual({ content: SECRET })
  expect(await tools.get("get")!.execute({ name: "API_TOKEN" }, context)).toEqual({ content: SECRET })
  expect(emitted.filter(([event]) => event === "requested")).toHaveLength(1)

  const replaced = tools.get("get")!.execute({ name: "API_TOKEN", replace: true }, context)
  await Bun.sleep(0)
  const [, again] = emitted.filter(([event]) => event === "requested").at(-1)!
  expect(again.reason).toBe("The agent needs API_TOKEN.")
  await handlers().submit({ requestID: again.requestID, value: "new-secret" })
  expect(await replaced).toEqual({ content: "new-secret" })
})

test("concurrent gets ask for one secret at a time", async () => {
  const { tools, emitted, handlers } = await harness()
  const requested = () => emitted.filter(([event]) => event === "requested")
  const get = (name: string) => tools.get("get")!.execute({ name, reason: "Call the API" }, context)
  const first = get("API_TOKEN")
  const second = get("NPM_TOKEN")
  const again = get("API_TOKEN")
  await Bun.sleep(0)
  expect(requested().map(([, data]) => data.name)).toEqual(["API_TOKEN"])
  await handlers().submit({ requestID: requested()[0][1].requestID, value: SECRET })
  await Bun.sleep(0)
  expect(requested().map(([, data]) => data.name)).toEqual(["API_TOKEN", "NPM_TOKEN"])
  await handlers().submit({ requestID: requested()[1][1].requestID, value: "npm-secret-123" })
  expect(await first).toEqual({ content: SECRET })
  expect(await second).toEqual({ content: "npm-secret-123" })
  expect(await again).toEqual({ content: SECRET })
  expect(requested()).toHaveLength(2)
})

test("a cancelled prompt does not block the next one", async () => {
  const { tools, emitted, handlers } = await harness()
  const requested = () => emitted.filter(([event]) => event === "requested")
  const first = tools.get("get")!.execute({ name: "API_TOKEN" }, context)
  const second = tools.get("get")!.execute({ name: "NPM_TOKEN" }, context)
  await Bun.sleep(0)
  await handlers().cancel({ requestID: requested()[0][1].requestID })
  await expect(first).rejects.toThrow("declined to provide API_TOKEN")
  await Bun.sleep(0)
  expect(requested().at(-1)![1].name).toBe("NPM_TOKEN")
  await handlers().submit({ requestID: requested().at(-1)![1].requestID, value: "npm-secret-123" })
  expect(await second).toEqual({ content: "npm-secret-123" })
})

test("fails when the user cancels or no TUI responds", async () => {
  const { tools, emitted, handlers, unreachable } = await harness()
  const request = () => tools.get("get")!.execute({ name: "API_TOKEN", reason: "Call the API" }, context)
  const requestID = () => emitted.filter(([event]) => event === "requested").at(-1)![1].requestID

  const cancelled = request()
  await Bun.sleep(0)
  await handlers().cancel({ requestID: requestID() })
  await expect(cancelled).rejects.toThrow("declined to provide API_TOKEN")

  expect(await handlers().ack({ requestID: requestID() })).toEqual({ accepted: false })

  unreachable()
  await expect(request()).rejects.toThrow("No OpenCode TUI with opencode-blindfold responded")
})

test("cancelling a tool call closes its prompt and unblocks the queue", async () => {
  const { tools, emitted, handlers } = await harness()
  const controller = new AbortController()
  const first = tools.get("get")!.execute({ name: "API_TOKEN" }, { ...context, signal: controller.signal })
  const second = tools.get("get")!.execute({ name: "NPM_TOKEN" }, context)
  await Bun.sleep(0)
  const requestID = emitted[0][1].requestID
  controller.abort()
  await expect(first).rejects.toThrow("The request for API_TOKEN was cancelled.")
  expect(await handlers().ack({ requestID })).toEqual({ accepted: false })
  await Bun.sleep(0)
  const requested = emitted.filter(([event]) => event === "requested")
  expect(requested.map(([, data]) => data.name)).toEqual(["API_TOKEN", "NPM_TOKEN"])
  await handlers().submit({ requestID: requested[1][1].requestID, value: "npm-secret-123" })
  expect(await second).toEqual({ content: "npm-secret-123" })
})

test("only the first client to acknowledge owns the prompt", async () => {
  const { tools, emitted, handlers } = await harness()
  const result = tools.get("get")!.execute({ name: "API_TOKEN" }, context)
  await Bun.sleep(0)
  const requestID = emitted[0][1].requestID
  expect(await handlers().ack({ requestID })).toEqual({ accepted: true })
  expect(await handlers().ack({ requestID })).toEqual({ accepted: false })
  await handlers().submit({ requestID, value: SECRET })
  expect(await result).toEqual({ content: SECRET })
})

test("rejects queued requests when the plugin is disposed", async () => {
  const { tools, emitted, cleanup } = await harness()
  const first = tools.get("get")!.execute({ name: "API_TOKEN" }, context).catch((error: Error) => error)
  const second = tools.get("get")!.execute({ name: "NPM_TOKEN" }, context).catch((error: Error) => error)
  await Bun.sleep(0)
  expect(emitted.filter(([event]) => event === "requested")).toHaveLength(1)
  if (cleanup) await cleanup()
  const firstError = await first
  const secondError = await second
  expect(firstError).toBeInstanceOf(Error)
  expect(secondError).toBeInstanceOf(Error)
  expect((firstError as Error).message).toContain("No OpenCode TUI with opencode-blindfold responded")
  expect((secondError as Error).message).toContain("opencode-blindfold is shutting down")
  expect(emitted.filter(([event]) => event === "requested")).toHaveLength(1)
})

test("redacts tool results, errors, model context, and provider requests", async () => {
  const { hooks, store } = await harness()
  await store()

  const completed = { tool: "shell", status: "completed", result: { content: `token=${SECRET}`, metadata: { output: [btoa(SECRET)] } } }
  await hooks.get("tool.execute.after")!(completed)
  expect(completed.result).toEqual({ content: "token=[REDACTED:API_TOKEN]", metadata: { output: ["[REDACTED:API_TOKEN]"] } })

  const read = { tool: "blindfold_get", status: "completed", result: { content: SECRET } }
  await hooks.get("tool.execute.after")!(read)
  expect(read.result.content).toBe(SECRET)

  const failed = { tool: "shell", status: "error", error: { message: `bad ${SECRET}`, metadata: undefined, error: SECRET } }
  await hooks.get("tool.execute.after")!(failed)
  expect(failed.error.message).toBe("bad [REDACTED:API_TOKEN]")
  expect(failed.error.error).toBeUndefined()

  const causeOnly = { tool: "shell", status: "error", error: { message: "failed", metadata: undefined, error: `cause ${SECRET}` } }
  await hooks.get("tool.execute.after")!(causeOnly)
  expect(causeOnly.error.message).toBe("failed")
  expect(causeOnly.error.error).toBeUndefined()

  const request = { system: [], messages: [{ role: "tool", content: [{ type: "tool-result", result: { type: "text", value: SECRET } }] }] }
  await hooks.get("session.context")!(request)
  expect(JSON.stringify(request.messages)).not.toContain(SECRET)
  expect(JSON.stringify(request.system)).not.toContain(SECRET)

  const http = { request: new Request("https://example.com", { method: "POST", body: JSON.stringify({ text: SECRET }) }) }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe(JSON.stringify({ text: "[REDACTED:API_TOKEN]" }))
})

test("leaves media data URLs byte-exact in provider requests and model context", async () => {
  const { hooks, store } = await harness()
  await store()
  await store("AAAA", "CHUNK")
  const image = `data:image/jpeg;base64,AAAAcG5n`
  const document = `data:application/pdf;base64,${Buffer.from(SECRET).toString("base64")}cG5n`
  const body = JSON.stringify({
    messages: [{ role: "tool", content: [{ type: "file", uri: image, mime: "image/jpeg" }, { type: "file", uri: document, mime: "application/pdf" }] }],
    text: `token=${SECRET}`,
  })
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  const next = await http.request.text()
  const parsed = JSON.parse(next)
  expect(parsed.messages[0].content[0].uri).toBe(image)
  expect(parsed.messages[0].content[1].uri).toBe(document)
  expect(parsed.text).toBe("token=[REDACTED:API_TOKEN]")
  expect(http.request.headers.get("content-length")).toBeNull()

  const context = { system: [], messages: [{ role: "tool", content: [{ type: "file", uri: image, mime: "image/jpeg" }] }] }
  await hooks.get("session.context")!(context)
  expect(context.messages[0].content[0].uri).toBe(image)

  const tool = { tool: "browser", status: "completed", result: { content: [{ type: "file", uri: image, mime: "image/jpeg" }] } }
  await hooks.get("tool.execute.after")!(tool)
  expect(tool.result.content[0].uri).toBe(image)
})

test("keeps text bodies valid while preserving data URLs", async () => {
  const { hooks, store } = await harness()
  await store()
  await store("AAAA", "CHUNK")
  const url = `data:image/png;base64,AAAAcG5n`
  const body = `token=${SECRET}\n${url}`
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": String(body.length) },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe(`token=[REDACTED:API_TOKEN]\n${url}`)
  expect(http.request.headers.get("content-length")).toBeNull()
})

test("preserves numbers, whitespace, and key order while redacting JSON strings", async () => {
  const { hooks, store } = await harness()
  await store()
  const body = [
    "{",
    '  "id": 9007199254740993,',
    '  "count": 1e20,',
    '  "escaped": "a\\/b\\u0041",',
    `  "text": "${SECRET}",`,
    `  "nested": { "id": 9007199254740995, "value": "${SECRET}" }`,
    "}",
  ].join("\n")
  const expected = body.replaceAll(`"${SECRET}"`, '"[REDACTED:API_TOKEN]"')
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe(expected)
})

test("does not redact JSON object keys", async () => {
  const { hooks, store } = await harness()
  await store()
  const body = `{"${SECRET}":"${SECRET}"}`
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe(`{"${SECRET}":"[REDACTED:API_TOKEN]"}`)
})

test("redacts escaped JSON string values", async () => {
  const { hooks, store } = await harness()
  const password = 'p@ss "word"/1234'
  await store(password, "PASSWORD")
  await store()
  const body = `{"quoted":"p@ss \\"word\\"/1234","unicode":"p@ss \\u0022word\\u0022\\/1234","lone":"\\ud800 ${SECRET}"}`
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  const parsed = JSON.parse(await http.request.text())
  expect(parsed.quoted).toBe("[REDACTED:PASSWORD]")
  expect(parsed.unicode).toBe("[REDACTED:PASSWORD]")
  expect(parsed.lone.charCodeAt(0)).toBe(0xd800)
  expect(parsed.lone.endsWith("[REDACTED:API_TOKEN]")).toBe(true)
})

test("keeps wrapped media data URLs in provider requests", async () => {
  const { hooks, store } = await harness()
  await store()
  await store("AAAA", "CHUNK")
  const line = "A".repeat(76)
  const lf = `data:image/png;base64,QUJD\n${line}`
  const crlf = `data:application/pdf;base64,QUJD\r\n${line}`
  const body = JSON.stringify({
    messages: [
      { type: "file", mime: "image/png", uri: lf },
      { type: "file", mime: "application/pdf", uri: crlf },
    ],
    text: `token=${SECRET}`,
  })
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  const parsed = JSON.parse(await http.request.text())
  expect(parsed.messages[0].uri).toBe(lf)
  expect(parsed.messages[1].uri).toBe(crlf)
  expect(parsed.text).toBe("token=[REDACTED:API_TOKEN]")
})

test("keeps provider inline base64 fields untouched while redacting nearby text", async () => {
  const { hooks, store } = await harness()
  await store("A", "A_TOKEN")
  const data = "A".repeat(100)
  const body = JSON.stringify({
    anthropic: { type: "image", source: { type: "base64", media_type: "image/gif", data }, tag: "A" },
    gemini: { inlineData: { mimeType: "image/png", data }, tag: "A" },
    bedrock: { source: { bytes: data }, tag: "A" },
  })
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  const parsed = JSON.parse(await http.request.text())
  expect(parsed.anthropic.source.data).toBe(data)
  expect(parsed.anthropic.tag).toBe("[REDACTED:A_TOKEN]")
  expect(parsed.gemini.inlineData.data).toBe(data)
  expect(parsed.gemini.tag).toBe("[REDACTED:A_TOKEN]")
  expect(parsed.bedrock.source.bytes).toBe(data)
  expect(parsed.bedrock.tag).toBe("[REDACTED:A_TOKEN]")

  const context = {
    system: [],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "A" }, { image: { source: { bytes: data } } }],
      },
    ],
  }
  await hooks.get("session.context")!(context)
  const content = context.messages[0]!.content as Array<{ text?: string; image?: { source: { bytes: string } } }>
  expect(content[0]!.text).toBe("[REDACTED:A_TOKEN]")
  expect(content[1]!.image!.source.bytes).toBe(data)
})

test("redacts plain text in data and bytes fields that are not base64", async () => {
  const { hooks, store } = await harness()
  await store("secret-value", "DATA")
  const body = '{"data":"secret-value","bytes":"secret-value"}'
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe('{"data":"[REDACTED:DATA]","bytes":"[REDACTED:DATA]"}')
})

test("keeps JSON escapes valid when a secret is one character", async () => {
  const { hooks, store } = await harness()
  await store("n", "LETTER_N")
  const body = JSON.stringify({ text: "line\nnext n" })
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  const next = await http.request.text()
  const parsed = JSON.parse(next)
  expect(parsed.text.startsWith("li")).toBe(true)
  expect(parsed.text).toContain("\n")
  expect(parsed.text.endsWith("[REDACTED:LETTER_N]")).toBe(true)
})

test("does not rewrite redaction markers on a second request pass", async () => {
  const { hooks, store } = await harness()
  await store("REDACTED", "MARKER")
  const body = JSON.stringify({ text: "REDACTED" })
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  const once = await http.request.text()
  expect(once).toBe(JSON.stringify({ text: "[REDACTED:MARKER]" }))
  const again = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: once,
    }),
  }
  await hooks.get("session.http.request")!(again)
  expect(await again.request.text()).toBe(once)
})

test("leaves compressed, binary, and oversized request bodies untouched", async () => {
  const { hooks, store } = await harness()
  await store()

  const compressed = gzipSync(Buffer.from(`token=${SECRET}`))
  const compressedRequest = new Request("https://example.com", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip" },
    body: compressed,
  })
  const gzip = { request: compressedRequest }
  await hooks.get("session.http.request")!(gzip)
  expect(gzip.request).toBe(compressedRequest)
  expect(Buffer.from(await gzip.request.arrayBuffer())).toEqual(compressed)

  const binary = Uint8Array.from([0, 1, 2, 255, 254])
  const octets = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: binary,
    }),
  }
  await hooks.get("session.http.request")!(octets)
  expect(new Uint8Array(await octets.request.arrayBuffer())).toEqual(binary)

  const invalid = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: Uint8Array.from([0xff, 0xfe, 0xfd]),
    }),
  }
  await hooks.get("session.http.request")!(invalid)
  expect(new Uint8Array(await invalid.request.arrayBuffer())).toEqual(Uint8Array.from([0xff, 0xfe, 0xfd]))

  const body = JSON.stringify({ text: SECRET })
  const oversized = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(64 * 1024 * 1024 + 1) },
      body,
    }),
  }
  await hooks.get("session.http.request")!(oversized)
  expect(await oversized.request.text()).toBe(body)
})

test("leaves invalid declared JSON untouched", async () => {
  const { hooks, store } = await harness()
  await store()
  const body = `{"text":"${SECRET}",}`
  const http = {
    request: new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe(body)
})

test("redacts commonly encoded values and prefers the longest overlapping secret", async () => {
  const { hooks, store } = await harness()
  const password = 'p@ss "word"/1234'
  await store(password, "PASSWORD")
  await store("abcdefgh", "SHORT")
  await store("abcdefgh-ijkl", "LONG")
  const bytes = Buffer.from(password)
  const encoded = [
    JSON.stringify(password).slice(1, -1),
    encodeURIComponent(password),
    bytes.toString("base64"),
    bytes.toString("base64url"),
    bytes.toString("hex"),
  ]
  const untouched = { text: "hello" }
  const event = { tool: "shell", status: "completed", result: { content: [...encoded, "abcdefgh-ijkl abcdefgh"].join("\n"), metadata: { untouched } } }
  await hooks.get("tool.execute.after")!(event)
  const lines = event.result.content.split("\n")
  expect(lines.slice(0, -1).every((line) => line.startsWith("[REDACTED:PASSWORD]"))).toBe(true)
  expect(lines.at(-1)).toBe("[REDACTED:LONG] [REDACTED:SHORT]")
  expect(event.result.metadata.untouched).toBe(untouched)
})

test("exposes secrets only to shell commands that name them", async () => {
  const { hooks, store } = await harness()
  await store()
  await store("other-secret", "OTHER_TOKEN")
  const env = async (command: string) => {
    const shell = { command, env: {} as Record<string, string> }
    await hooks.get("shell.create.before")!(shell)
    return shell.env
  }
  expect(await env('curl -H "Authorization: Bearer $API_TOKEN" https://example.com')).toEqual({ API_TOKEN: SECRET })
  expect(await env("python -c 'import os; print(os.environ[\"API_TOKEN\"])'")).toEqual({ API_TOKEN: SECRET })
  expect(await env("printenv")).toEqual({})
  expect(await env("echo $MY_API_TOKEN $API_TOKEN_2")).toEqual({})
})

test("asks before shell commands that name a secret", async () => {
  const { hooks, store } = await harness()
  await store()
  const evaluate = async (event: Record<string, unknown>) => {
    const permission = { effect: "allow", ...event }
    await hooks.get("permission.evaluate")!(permission)
    return permission
  }
  expect(await evaluate({ action: "shell", resources: ["ls", "echo ${API_TOKEN}"] }))
    .toMatchObject({ effect: "ask", message: "This command can read API_TOKEN" })
  expect(await evaluate({ action: "shell", resources: ["printenv"] })).toMatchObject({ effect: "allow" })
  expect(await evaluate({ action: "read", resources: ["API_TOKEN"] })).toMatchObject({ effect: "allow" })
  expect(await evaluate({ action: "shell", resources: ["echo $API_TOKEN"], effect: "deny" })).toMatchObject({ effect: "deny" })
})

test("shell approval and env injection can be turned off", async () => {
  const allowed = await harness({ shell: { approve: false } })
  expect(allowed.hooks.has("permission.evaluate")).toBe(false)
  expect(allowed.tools.get("get")!.description).not.toContain("approve")
  expect(allowed.hooks.has("shell.create.before")).toBe(true)

  const disabled = await harness({ shell: { enabled: false } })
  expect(disabled.hooks.has("permission.evaluate")).toBe(false)
  expect(disabled.hooks.has("shell.create.before")).toBe(false)
  expect(disabled.tools.get("get")!.description).not.toContain("Shell")
})

test("redacts one-character secrets in raw form only", async () => {
  const { hooks, store } = await harness()
  await store("Z")
  const event = { tool: "shell", status: "completed", result: { content: `Z ${Buffer.from("Z").toString("hex")}` } }
  await hooks.get("tool.execute.after")!(event)
  expect(event.result.content).toBe("[REDACTED:API_TOKEN] 5a")
})

// Signed in to several accounts, the real CLI refuses to read until one is picked with --account.
function fakeOnePassword({ accounts = 1, error }: { accounts?: number; error?: OpError } = {}) {
  opCalls.length = 0
  opOptions.length = 0
  opReply = (args) => {
    if (error) return { error }
    const reference = args.at(-1)!
    if (!args.includes("--account") && accounts > 1) {
      return {
        error: new Error("multiple accounts"),
        stderr: "[ERROR] could not read secret 'multiple': error initializing client: multiple accounts found. Use the --account flag or set the OP_ACCOUNT environment variable to select an account.",
      }
    }
    switch (reference) {
      case "op://Agents/Zen/credential":
        return { stdout: "zen-secret-123" }
      case "op://Agents/Empty/credential":
        return {}
      default:
        return {
          error: new Error("item not found"),
          stderr: `[ERROR] could not read secret '${reference}': item not found`,
        }
    }
  }
  return {
    calls: () => opCalls.map(([file, ...args]) => args.join(" ")),
    binaries: () => opCalls.map(([file]) => file),
    options: () => opOptions,
  }
}

test("configured plain secrets are available without asking and redacted from the start", async () => {
  const { tools, hooks, emitted } = await harness({ secrets: { API_TOKEN: SECRET } })
  const completed = { tool: "shell", status: "completed", result: { content: `token=${SECRET}` } }
  await hooks.get("tool.execute.after")!(completed)
  expect(completed.result.content).toBe("token=[REDACTED:API_TOKEN]")
  const shell = { command: "echo $API_TOKEN", env: {} as Record<string, string> }
  await hooks.get("shell.create.before")!(shell)
  expect(shell.env).toEqual({ API_TOKEN: SECRET })
  expect(await tools.get("get")!.execute({ name: "API_TOKEN" }, context)).toEqual({ content: SECRET })
  expect(emitted).toHaveLength(0)

  const request = { system: [] as Array<{ type: string; text: string }>, messages: [] }
  await hooks.get("session.context")!(request)
  expect(request.system[0].text).toContain("The user has configured these secrets: API_TOKEN.")
})

test("reads op:// secrets from 1Password once, on first use", async () => {
  const op = fakeOnePassword()
  const { tools, hooks, emitted } = await harness({ secrets: { ZEN_KEY: "op://Agents/Zen/credential" } })
  expect(op.calls()).toEqual([])
  expect(await tools.get("get")!.execute({ name: "ZEN_KEY" }, context)).toEqual({ content: "zen-secret-123" })
  expect(await tools.get("get")!.execute({ name: "ZEN_KEY" }, context)).toEqual({ content: "zen-secret-123" })
  expect(op.calls()).toEqual(["read --no-newline op://Agents/Zen/credential"])
  expect(op.binaries()).toEqual(["op"])
  expect(op.options()).toEqual([{ timeout: 2 * 60_000, windowsHide: true }])
  expect(emitted).toHaveLength(0)

  const completed = { tool: "shell", status: "completed", result: { content: "zen-secret-123" } }
  await hooks.get("tool.execute.after")!(completed)
  expect(completed.result.content).toBe("[REDACTED:ZEN_KEY]")

  await tools.get("get")!.execute({ name: "ZEN_KEY", replace: true }, context)
  expect(op.calls()).toHaveLength(2)
})

test("falls back to the personal 1Password account when several are signed in", async () => {
  const op = fakeOnePassword({ accounts: 2 })
  const { tools } = await harness({ secrets: { ZEN_KEY: "op://Agents/Zen/credential" } })
  expect(await tools.get("get")!.execute({ name: "ZEN_KEY" }, context)).toEqual({ content: "zen-secret-123" })
  expect(op.calls()).toEqual([
    "read --no-newline op://Agents/Zen/credential",
    "read --no-newline --account my.1password.com op://Agents/Zen/credential",
  ])
})

test("reads from the configured 1Password account", async () => {
  const op = fakeOnePassword({ accounts: 2 })
  const { tools } = await harness({
    secrets: { ZEN_KEY: "op://Agents/Zen/credential" },
    "1password": { account: "acme.1password.com" },
  })
  expect(await tools.get("get")!.execute({ name: "ZEN_KEY" }, context)).toEqual({ content: "zen-secret-123" })
  expect(op.calls()).toEqual(["read --no-newline --account acme.1password.com op://Agents/Zen/credential"])
})

test("configured secrets fail with a clear error instead of asking", async () => {
  fakeOnePassword()
  const { tools, emitted } = await harness({
    secrets: { MISSING: "op://Agents/Missing/credential", BLANK: "op://Agents/Empty/credential", UNSET: "" },
  })
  const get = (name: string) => tools.get("get")!.execute({ name }, context)
  await expect(get("MISSING")).rejects.toThrow(
    "Couldn't read MISSING from 1Password (op://Agents/Missing/credential): [ERROR] could not read secret 'op://Agents/Missing/credential': item not found",
  )
  await expect(get("BLANK")).rejects.toThrow("Couldn't read BLANK from 1Password (op://Agents/Empty/credential): the field is empty.")
  await expect(get("UNSET")).rejects.toThrow("UNSET is empty in the opencode-blindfold secrets option")
  expect(emitted).toHaveLength(0)
})

test("explains when the 1Password CLI isn't installed", async () => {
  fakeOnePassword({ error: Object.assign(new Error("spawn op ENOENT"), { code: "ENOENT" }) })
  const { tools } = await harness({ secrets: { ZEN_KEY: "op://Agents/Zen/credential" } })
  await expect(tools.get("get")!.execute({ name: "ZEN_KEY" }, context)).rejects.toThrow("the 1Password CLI (op) isn't installed.")
})

test("explains when 1Password times out", async () => {
  const killed = Object.assign(new Error("Command failed: op read"), { killed: true })
  const timedOut = Object.assign(new Error("Command failed: op read"), { code: "ETIMEDOUT" })
  for (const error of [killed, timedOut]) {
    fakeOnePassword({ error })
    const { tools } = await harness({ secrets: { ZEN_KEY: "op://Agents/Zen/credential" } })
    await expect(tools.get("get")!.execute({ name: "ZEN_KEY" }, context)).rejects.toThrow(
      "timed out waiting for 1Password. Check that it's unlocked.",
    )
  }
})

test("rejects invalid options and empty secrets", async () => {
  await expect(harness({ secrets: ["API_TOKEN"] })).rejects.toThrow("secrets option must be an object")
  await expect(harness({ secrets: { api_token: "x" } })).rejects.toThrow("secrets names must match")
  await expect(harness({ secrets: { API_TOKEN: 1 } })).rejects.toThrow("secrets.API_TOKEN option must be a string")
  await expect(harness({ "1password": { account: "" } })).rejects.toThrow("1password.account option must be a non-empty string")
  await expect(harness({ shell: { enabled: "yes" } })).rejects.toThrow("shell.enabled option")
  await expect(harness({ shell: true })).rejects.toThrow("shell option must be an object")
  await expect(harness({ shell: { enabled: false }, codemode: { enabled: false } })).rejects.toThrow("secrets cannot be used")
  const { tools, emitted, handlers } = await harness()
  const result = tools.get("get")!.execute({ name: "API_TOKEN", reason: "Call the API" }, context)
  await Bun.sleep(0)
  const { requestID } = emitted[0][1]
  expect(await handlers().submit({ requestID, value: "" })).toEqual({ accepted: false })
  await handlers().cancel({ requestID })
  await expect(result).rejects.toThrow("declined to provide API_TOKEN")
})

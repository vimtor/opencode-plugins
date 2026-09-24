import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import blindfold from "opencode-blindfold"

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
  const cleanup = await blindfold.setup({
    options,
    rpc: {
      register: async (_: unknown, value: Record<string, Handler>) => {
        handlers = value
        return { dispose: async () => {}, events: { emit: async (name: string, data: Record<string, unknown>) => { emitted.push([name, data]) } } }
      },
    },
    tool: {
      transform: async (transform: (editor: Pick<ToolEditor, "add" | "namespace">) => void) =>
        transform({ namespace: () => {}, add: (tool: Info) => { tools.set(tool.name, tool) } }),
      hook: async (name: string, hook: Hook) => { hooks.set(`tool.${name}`, hook) },
    },
    session: { hook: async (name: string, hook: Hook) => { hooks.set(`session.${name}`, hook) } },
    shell: { hook: async (name: string, hook: Hook) => { hooks.set(`shell.${name}`, hook) } },
  } as unknown as Plugin.Context)

  async function store(value = SECRET, name = "API_TOKEN") {
    const result = tools.get("request")!.execute({ name, reason: "Call the API" }, context)
    await Bun.sleep(0)
    const [, data] = emitted.filter(([event]) => event === "requested").at(-1)!
    await handlers.submit({ requestID: data.requestID, value })
    return result
  }

  return { tools, hooks, emitted, handlers: () => handlers, store, cleanup }
}

test("requests a secret through the TUI without returning its value", async () => {
  const { tools, emitted, store } = await harness()
  const result = await store()
  expect(emitted[0]).toEqual(["requested", expect.objectContaining({ sessionID: "ses_test", name: "API_TOKEN", reason: "Call the API" })])
  expect(emitted[1]).toEqual(["resolved", { requestID: emitted[0][1].requestID }])
  expect(JSON.stringify(result)).not.toContain(SECRET)
  expect(tools.get("get")!.options).toEqual({ namespace: "blindfold", codemode: true })
  expect(await tools.get("get")!.execute({ name: "API_TOKEN" }, context)).toEqual({ content: SECRET })
})

test("fails when the user cancels, no TUI responds, or the request times out", async () => {
  const { tools, emitted, handlers } = await harness({ timeout: 20 })
  const request = () => tools.get("request")!.execute({ name: "API_TOKEN", reason: "Call the API" }, context)
  const requestID = () => emitted.filter(([event]) => event === "requested").at(-1)![1].requestID

  const cancelled = request()
  await Bun.sleep(0)
  await handlers().cancel({ requestID: requestID() })
  await expect(cancelled).rejects.toThrow("declined to provide API_TOKEN")

  await expect(request()).rejects.toThrow("No OpenCode TUI with opencode-blindfold responded")

  const acknowledged = request()
  await Bun.sleep(0)
  expect(await handlers().ack({ requestID: requestID() })).toEqual({ accepted: true })
  await expect(acknowledged).rejects.toThrow("Timed out waiting")
  expect(await handlers().ack({ requestID: requestID() })).toEqual({ accepted: false })

  await expect(tools.get("get")!.execute({ name: "API_TOKEN" }, context)).rejects.toThrow("No secret named API_TOKEN")
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

  const request = { system: [], messages: [{ role: "tool", content: [{ type: "tool-result", result: { type: "text", value: SECRET } }] }] }
  await hooks.get("session.context")!(request)
  expect(JSON.stringify(request.messages)).not.toContain(SECRET)
  expect(JSON.stringify(request.system)).toContain("API_TOKEN")

  const http = { request: new Request("https://example.com", { method: "POST", body: JSON.stringify({ text: SECRET }) }) }
  await hooks.get("session.http.request")!(http)
  expect(await http.request.text()).toBe(JSON.stringify({ text: "[REDACTED:API_TOKEN]" }))
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

test("exposes secrets to shell commands unless disabled", async () => {
  const enabled = await harness()
  await enabled.store()
  const shell = { env: {} as Record<string, string> }
  await enabled.hooks.get("shell.create.before")!(shell)
  expect(shell.env).toEqual({ API_TOKEN: SECRET })

  const disabled = await harness({ env: false })
  expect(disabled.hooks.has("shell.create.before")).toBe(false)
})

test("redacts one-character secrets in raw form only", async () => {
  const { hooks, store } = await harness()
  await store("Z")
  const event = { tool: "shell", status: "completed", result: { content: `Z ${Buffer.from("Z").toString("hex")}` } }
  await hooks.get("tool.execute.after")!(event)
  expect(event.result.content).toBe("[REDACTED:API_TOKEN] 5a")
})

test("rejects invalid options and empty secrets", async () => {
  await expect(harness({ env: "yes" })).rejects.toThrow("env option")
  await expect(harness({ timeout: 0 })).rejects.toThrow("timeout option")
  const { tools, emitted, handlers } = await harness({ timeout: 20 })
  const result = tools.get("request")!.execute({ name: "API_TOKEN", reason: "Call the API" }, context)
  await Bun.sleep(0)
  expect(await handlers().submit({ requestID: emitted[0][1].requestID, value: "" })).toEqual({ accepted: false })
  await expect(result).rejects.toThrow("API_TOKEN")
})

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin, SetupContext } from "@opencode/plugin/gui"
import { createRoot, createSignal } from "solid-js"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-bubble-tabs/tui"))))
  const { gui } = Host.resolve({ directory })
  if (!gui) throw new Error("Missing GUI entrypoint")
  const provided: Record<string, unknown> = {
    "solid-js": await import("solid-js"),
    "@opencode/plugin/gui": await import("@opencode/plugin/gui"),
  }
  const module = { exports: {} as { default?: Plugin.Definition } }
  const require = (id: string) => {
    if (id in provided) return provided[id]
    throw new Error(`The app does not provide ${id}`)
  }
  new Function("module", "exports", "require", readFileSync(fileURLToPath(gui), "utf8"))(module, module.exports, require)
  if (!module.exports.default?.setup) throw new Error("Missing GUI setup")
  return module.exports.default.setup
}

const setup = await load()

type Handler = (event: unknown) => void

function data(parents: Record<string, string> = {}) {
  const handlers = new Map<string, Set<Handler>>()
  return {
    handlers,
    on: (type: string, handler: Handler) => {
      const set = handlers.get(type) ?? new Set()
      handlers.set(type, set.add(handler))
      return () => set.delete(handler)
    },
    session: { root: (sessionID: string) => parents[sessionID] ?? sessionID },
    emit: (type: string, value: unknown) => {
      for (const handler of handlers.get(type) ?? []) handler({ type, data: value })
    },
  }
}

function mount(input: { options?: Record<string, unknown>; parents?: Record<string, string>; server?: string } = {}) {
  const [server, setServer] = createSignal(data(input.parents))
  const tabs = ["ses_a", "ses_b", "ses_c"].map((id) => ({
    key: `tab_${id}`,
    session: { id, server: { id: input.server ?? "sidecar" } },
    active: false,
  }))
  const moves: [string, number][] = []
  const ctx = {
    options: input.options ?? {},
    servers: { get: (id: string) => (id === "sidecar" ? { id, data: server() } : undefined) },
    tabs: {
      list: () => tabs,
      move: (key: string, index: number) => {
        moves.push([key, index])
        const from = tabs.findIndex((tab) => tab.key === key)
        tabs.splice(index, 0, ...tabs.splice(from, 1))
      },
    },
  } as unknown as SetupContext<{}>
  const dispose = createRoot((dispose) => {
    setup(ctx)
    return dispose
  })
  const order = () => tabs.map((tab) => tab.session.id)
  return { order, moves, dispose, server, setServer }
}

const message = (sessionID: string, type = "user") => ({ sessionID, item: { type } })

test("moves the tab to the front when a session finishes", () => {
  const { order, server } = mount()
  server().emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(order()).toEqual(["ses_b", "ses_a", "ses_c"])
  server().emit("session.execution.failed", { sessionID: "ses_c" })
  expect(order()).toEqual(["ses_c", "ses_b", "ses_a"])
})

test("moves the parent tab when a subagent needs input", () => {
  const { order, server } = mount({ parents: { ses_child: "ses_c" } })
  server().emit("permission.asked", { sessionID: "ses_child" })
  expect(order()).toEqual(["ses_c", "ses_a", "ses_b"])
  server().emit("form.created", { form: { sessionID: "ses_b" } })
  expect(order()).toEqual(["ses_b", "ses_c", "ses_a"])
})

test("follows the on option", () => {
  const { order, server } = mount({ options: { on: ["prompt"] } })
  server().emit("session.execution.succeeded", { sessionID: "ses_b" })
  server().emit("session.inbox.enqueued", message("ses_b", "synthetic"))
  expect(order()).toEqual(["ses_a", "ses_b", "ses_c"])
  server().emit("session.inbox.enqueued", message("ses_c"))
  expect(order()).toEqual(["ses_c", "ses_a", "ses_b"])
})

test("ignores tabs of other servers", () => {
  const { moves, server } = mount({ server: "http://remote:4096" })
  server().emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(moves).toEqual([])
})

test("listens again when the server restarts", () => {
  const { order, server, setServer } = mount()
  const stale = server()
  setServer(data())
  expect([...stale.handlers.values()].every((set) => set.size === 0)).toBe(true)
  server().emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(order()).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("stops listening when the plugin stops", () => {
  const { dispose, server } = mount()
  dispose()
  expect([...server().handlers.values()].every((set) => set.size === 0)).toBe(true)
})

test("rejects an invalid on option", () => {
  expect(() => mount({ options: { on: ["prompts"] } })).toThrow(
    'opencode-bubble-tabs on option must be an array of "prompt", "done", or "ask"',
  )
})

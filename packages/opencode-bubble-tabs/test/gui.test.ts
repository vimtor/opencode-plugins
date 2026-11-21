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
  const tab = (id: string, server = input.server ?? "sidecar") => ({
    key: `tab_${id}`,
    session: { id, server: { id: server } },
    active: false,
  })
  const [tabs, setTabs] = createSignal(["ses_a", "ses_b", "ses_c"].map((id) => tab(id)))
  const moves: [string, number][] = []
  const opens: { server: string; id: string }[] = []
  const ctx = {
    options: input.options ?? {},
    servers: { get: (id: string) => (id === "sidecar" ? { id, data: server() } : undefined) },
    tabs: {
      list: tabs,
      move: (key: string, index: number) => {
        moves.push([key, index])
        const next = [...tabs()]
        const from = next.findIndex((tab) => tab.key === key)
        next.splice(index, 0, ...next.splice(from, 1))
        setTabs(next)
      },
      open: (session: { server: string; id: string }) => {
        opens.push(session)
        setTabs([...tabs(), tab(session.id, session.server)])
      },
    },
  } as unknown as SetupContext<{}>
  const dispose = createRoot((dispose) => {
    setup(ctx)
    return dispose
  })
  const order = () => tabs().map((tab) => tab.session.id)
  const add = (id: string) => setTabs([...tabs(), tab(id)])
  const close = (id: string) => setTabs(tabs().filter((tab) => tab.session.id !== id))
  return { order, moves, opens, add, close, dispose, server, setServer }
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

test("reopens a closed tab at the front when its session finishes", () => {
  const { order, opens, close, server } = mount()
  close("ses_b")
  server().emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(opens).toEqual([{ server: "sidecar", id: "ses_b" }])
  expect(order()).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("reopens a tab opened after startup", () => {
  const { order, add, close, server } = mount()
  add("ses_new")
  close("ses_new")
  server().emit("form.created", { form: { sessionID: "ses_new" } })
  expect(order()).toEqual(["ses_new", "ses_a", "ses_b", "ses_c"])
})

test("leaves sessions that never had a tab closed", () => {
  const { opens, moves, server } = mount({ parents: { ses_child: "ses_c" } })
  server().emit("session.execution.succeeded", { sessionID: "ses_other" })
  server().emit("session.execution.succeeded", { sessionID: "ses_child" })
  expect(opens).toEqual([])
  expect(moves).toEqual([])
})

test("leaves closed tabs closed with reopen false", () => {
  const { opens, close, server } = mount({ options: { reopen: false } })
  close("ses_b")
  server().emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(opens).toEqual([])
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

test("rejects an invalid reopen option", () => {
  expect(() => mount({ options: { reopen: "yes" } })).toThrow("opencode-bubble-tabs reopen option must be true or false")
})

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin, SetupContext } from "@opencode/plugin/gui"
import { createRoot, createSignal } from "solid-js"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-external-tabs/tui"))))
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

function data(creating: string[] = []) {
  const handlers = new Map<string, Set<Handler>>()
  return {
    handlers,
    on: (type: string, handler: Handler) => {
      const set = handlers.get(type) ?? new Set()
      handlers.set(type, set.add(handler))
      return () => set.delete(handler)
    },
    session: { creating: (sessionID: string) => creating.includes(sessionID) },
    emit: (type: string, value: unknown) => {
      for (const handler of handlers.get(type) ?? []) handler({ type, data: value })
    },
  }
}

function mount(creating?: string[]) {
  const [server, setServer] = createSignal(data(creating))
  const opened: unknown[] = []
  const ctx = {
    options: {},
    servers: { get: (id: string) => (id === "sidecar" ? { id, data: server() } : undefined) },
    tabs: { open: (session: unknown, options?: unknown) => opened.push(options ? [session, options] : session) },
  } as unknown as SetupContext<{}>
  const dispose = createRoot((dispose) => {
    setup(ctx)
    return dispose
  })
  return { opened, dispose, server, setServer }
}

const created = (sessionID: string, extra: Record<string, unknown> = {}) => ({
  sessionID,
  location: { directory: "/project" },
  ...extra,
})

test("opens sessions other clients create as background tabs", () => {
  const { opened, server } = mount()
  server().emit("session.created", created("ses_run"))
  expect(opened).toEqual([{ server: "sidecar", id: "ses_run" }])
})

test("skips subagents, tab: false, and sessions this window creates", () => {
  const { opened, server } = mount(["ses_mine"])
  server().emit("session.created", created("ses_child", { parentID: "ses_run" }))
  server().emit("session.created", created("ses_later", { metadata: { tab: false } }))
  server().emit("session.created", created("ses_mine"))
  expect(opened).toEqual([])
})

test("opens a session when its metadata sets tab: true", () => {
  const { opened, server } = mount()
  server().emit("session.metadata.updated", { sessionID: "ses_later", metadata: { tab: false } })
  server().emit("session.metadata.updated", { sessionID: "ses_later", metadata: { tab: true } })
  expect(opened).toEqual([{ server: "sidecar", id: "ses_later" }])
})

test("listens again when the server restarts, and stops with the plugin", () => {
  const { opened, server, setServer, dispose } = mount()
  const stale = server()
  setServer(data())
  expect([...stale.handlers.values()].every((set) => set.size === 0)).toBe(true)
  server().emit("session.created", created("ses_run"))
  expect(opened).toEqual([{ server: "sidecar", id: "ses_run" }])
  dispose()
  expect([...server().handlers.values()].every((set) => set.size === 0)).toBe(true)
})

import { beforeAll, expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"

let bubbleTabs: typeof import("opencode-bubble-tabs/tui").default
beforeAll(async () => {
  bubbleTabs = (await import("opencode-bubble-tabs/tui")).default
})

type Handler = (event: unknown) => void

async function setup(input: {
  options?: Record<string, unknown>
  tabs?: string[]
  enabled?: boolean
  parents?: Record<string, string>
} = {}) {
  const handlers = new Map<string, Set<Handler>>()
  const tabs = [...(input.tabs ?? ["ses_a", "ses_b", "ses_c"])]
  const moves: [string, number][] = []
  const opens: string[] = []
  const cleanup = await bubbleTabs.setup({
    options: input.options ?? {},
    data: {
      on: (type: string, handler: Handler) => {
        const set = handlers.get(type) ?? new Set()
        handlers.set(type, set.add(handler))
        return () => set.delete(handler)
      },
      session: { root: (sessionID: string) => input.parents?.[sessionID] ?? sessionID },
    },
    ui: {
      tabs: {
        enabled: () => input.enabled ?? true,
        list: () => tabs.map((sessionID) => ({ sessionID, active: sessionID === "ses_c", busy: false, attention: false })),
        move: (sessionID: string, index: number) => {
          if (!tabs.includes(sessionID)) return false
          moves.push([sessionID, index])
          tabs.splice(tabs.indexOf(sessionID), 1)
          tabs.splice(index, 0, sessionID)
          return true
        },
        // The TUI adds an opened tab once it has saved it.
        open: (sessionID: string) => {
          opens.push(sessionID)
          setTimeout(() => {
            if (!tabs.includes(sessionID)) tabs.push(sessionID)
          }, 30)
          return true
        },
      },
    },
  } as unknown as Plugin.Context)
  const emit = (type: string, data: unknown) => {
    for (const handler of handlers.get(type) ?? []) handler({ type, data })
  }
  const close = (sessionID: string) => tabs.splice(tabs.indexOf(sessionID), 1)
  return { tabs, moves, opens, emit, close, handlers, cleanup: async () => { if (cleanup) await cleanup() } }
}

const message = (sessionID: string, type = "user") => ({
  sessionID,
  inboxID: "msg_1",
  item: { type, payload: { text: "hi" }, delivery: "steer" },
})

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-bubble-tabs/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", bubbleTabs)
})

test.each(["session.execution.succeeded", "session.execution.failed"])("moves the tab to the front on %s", async (type) => {
  const { tabs, emit } = await setup()
  emit(type, { sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("leaves tabs in place when you submit a prompt by default", async () => {
  const { moves, emit } = await setup()
  emit("session.inbox.enqueued", message("ses_c"))
  expect(moves).toEqual([])
})

test("moves the tab when you submit a prompt with on prompt", async () => {
  const { tabs, emit } = await setup({ options: { on: ["prompt"] } })
  emit("session.inbox.enqueued", message("ses_c"))
  expect(tabs).toEqual(["ses_c", "ses_a", "ses_b"])
  emit("session.execution.succeeded", { sessionID: "ses_b" })
  emit("permission.asked", { id: "per_1", sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_c", "ses_a", "ses_b"])
})

test("moves only on completion with on done", async () => {
  const { tabs, emit } = await setup({ options: { on: ["done"] } })
  emit("permission.asked", { id: "per_1", sessionID: "ses_b" })
  emit("form.created", { form: { sessionID: "ses_b", title: "Question", fields: [] } })
  expect(tabs).toEqual(["ses_a", "ses_b", "ses_c"])
  emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("moves only on input requests with on ask", async () => {
  const { tabs, emit } = await setup({ options: { on: ["ask"] } })
  emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_a", "ses_b", "ses_c"])
  emit("permission.asked", { id: "per_1", sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("combines triggers", async () => {
  const { tabs, emit } = await setup({ options: { on: ["prompt", "done", "ask"] } })
  emit("session.inbox.enqueued", message("ses_c"))
  emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_b", "ses_c", "ses_a"])
})

test("ignores non-user inbox items", async () => {
  const { moves, emit } = await setup({ options: { on: ["prompt"] } })
  emit("session.inbox.enqueued", message("ses_c", "synthetic"))
  emit("session.inbox.enqueued", message("ses_c", "compaction"))
  expect(moves).toEqual([])
})

test("moves the tab when a permission is asked", async () => {
  const { tabs, emit } = await setup()
  emit("permission.asked", { id: "per_1", sessionID: "ses_b" })
  expect(tabs).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("moves the tab when a question form is created", async () => {
  const { tabs, emit } = await setup()
  emit("form.created", { form: { sessionID: "ses_c", title: "Question", fields: [] } })
  expect(tabs).toEqual(["ses_c", "ses_a", "ses_b"])
})

test("moves the parent tab when a subagent needs input", async () => {
  const { tabs, emit } = await setup({ parents: { ses_child: "ses_c" } })
  emit("permission.asked", { id: "per_1", sessionID: "ses_child" })
  expect(tabs).toEqual(["ses_c", "ses_a", "ses_b"])
  emit("form.created", { form: { sessionID: "ses_child", title: "Question", fields: [] } })
  expect(tabs).toEqual(["ses_c", "ses_a", "ses_b"])
})

test("ignores subagent completions", async () => {
  const { moves, opens, emit } = await setup({ parents: { ses_child: "ses_c" } })
  emit("session.execution.succeeded", { sessionID: "ses_child" })
  expect(moves).toEqual([])
  expect(opens).toEqual([])
})

test("reopens a closed tab at the front when its session finishes", async () => {
  const { tabs, emit, close } = await setup()
  close("ses_b")
  emit("session.execution.succeeded", { sessionID: "ses_b" })
  await Bun.sleep(100)
  expect(tabs).toEqual(["ses_b", "ses_a", "ses_c"])
})

test("reopens a tab opened after startup once you prompted it", async () => {
  const { tabs, emit, close } = await setup()
  tabs.push("ses_new")
  emit("session.inbox.enqueued", message("ses_new"))
  close("ses_new")
  emit("permission.asked", { id: "per_1", sessionID: "ses_new" })
  await Bun.sleep(100)
  expect(tabs).toEqual(["ses_new", "ses_a", "ses_b", "ses_c"])
})

test("leaves sessions that never had a tab closed", async () => {
  const { moves, opens, emit } = await setup()
  emit("session.execution.succeeded", { sessionID: "ses_other" })
  expect(opens).toEqual([])
  expect(moves).toEqual([])
})

test("leaves closed tabs closed with reopen false", async () => {
  const { opens, emit, close } = await setup({ options: { reopen: false } })
  close("ses_b")
  emit("session.execution.succeeded", { sessionID: "ses_b" })
  expect(opens).toEqual([])
})

test("does nothing when tabs are disabled", async () => {
  const { moves, emit } = await setup({ enabled: false })
  emit("session.execution.succeeded", { sessionID: "ses_c" })
  expect(moves).toEqual([])
})

test("stops listening on cleanup", async () => {
  const { moves, emit, handlers, cleanup } = await setup()
  await cleanup()
  for (const set of handlers.values()) expect(set.size).toBe(0)
  emit("session.execution.succeeded", { sessionID: "ses_c" })
  expect(moves).toEqual([])
})

test.each([["prompts"], "done", [true], {}])("rejects invalid on option %p", (on) => {
  expect(() => bubbleTabs.setup({ options: { on } } as unknown as Plugin.Context)).toThrow(
    'opencode-bubble-tabs on option must be an array of "prompt", "done", or "ask"',
  )
})

test.each(["yes", 1, null])("rejects invalid reopen option %p", (reopen) => {
  expect(() => bubbleTabs.setup({ options: { reopen } } as unknown as Plugin.Context)).toThrow(
    "opencode-bubble-tabs reopen option must be true or false",
  )
})

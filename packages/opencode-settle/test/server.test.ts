import { expect, test } from "bun:test"
import plugin from "opencode-settle"
import * as run from "opencode-settle/run"
import type { State } from "opencode-settle/run"

type Handler = (input: unknown, context: { error: (...args: unknown[]) => unknown }) => Promise<unknown>

// The parts of the plugin context the server part uses.
async function load() {
  const stored = new Map<string, unknown>()
  const handlers: Record<string, Handler> = {}
  const emitted: { name: string; data: unknown }[] = []
  const tools: { name: string; execute: (input: unknown, context: unknown) => Promise<{ content: string }> }[] = []
  const ctx = {
    location: { directory: "/work" },
    storage: {
      get: async (key: string) => stored.get(key),
      set: async (key: string, value: unknown) => void stored.set(key, value),
      scan: async ({ prefix }: { prefix: string }) => ({
        entries: [...stored].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
      }),
    },
    rpc: {
      register: async (_definition: unknown, registered: Record<string, Handler>) => {
        Object.assign(handlers, registered)
        return { events: { emit: async (name: string, data: unknown) => void emitted.push({ name, data }) } }
      },
    },
    tool: {
      transform: async (callback: (editor: { add: (tool: (typeof tools)[number]) => void }) => void) =>
        callback({ add: (tool) => void tools.push(tool) }),
    },
  }
  await plugin.setup(ctx as never)
  const error = (type: unknown, message: unknown) => ({ error: type, message })
  const call = (name: string, input: unknown) => handlers[name]!(input, { error })
  return { tools, emitted, call }
}

const input = {
  title: "Speeds",
  axes: [{ id: "look", title: "How it looks" }],
  decisions: [
    {
      id: "picker",
      axis: "look",
      question: "How do you pick a speed?",
      options: [
        { id: "list", title: "Plain list", blocks: [{ type: "text", text: "Like /variants." }] },
        { id: "cycle", title: "Cycle with a key", blocks: [] },
      ],
    },
  ],
}

test("the settle tool stores the deck, opens it and returns at once", async () => {
  const { tools, emitted, call } = await load()
  const tool = tools.find((item) => item.name === "settle")!
  const result = await tool.execute(input, { sessionID: "ses_1" })
  expect(result.content).toContain("Speeds")
  const opened = emitted[0]!.data as { deckID: string; sessionID: string }
  expect(emitted[0]!.name).toBe("opened")
  expect(opened.sessionID).toBe("ses_1")
  const { decks } = (await call("list", { sessionID: "ses_1" })) as { decks: unknown[] }
  expect(decks).toEqual([{ id: opened.deckID, title: "Speeds", status: "open", sessionID: "ses_1" }])
})

test("an invalid deck fails with the field that's wrong", async () => {
  const { tools } = await load()
  const tool = tools.find((item) => item.name === "settle")!
  const bad = { ...input, decisions: [{ ...input.decisions[0]!, options: [input.decisions[0]!.options[0]!] }] }
  await expect(tool.execute(bad, { sessionID: "ses_1" })).rejects.toThrow("needs at least 2")
})

test("a deck counts as done once every decision is picked, even if a save lands after finish", async () => {
  const { tools, emitted, call } = await load()
  await tools.find((item) => item.name === "settle")!.execute(input, { sessionID: "ses_1" })
  const { deckID } = emitted[0]!.data as { deckID: string }
  const entry = (await call("get", { deckID })) as { deck: Parameters<typeof run.start>[0] }
  const done: State = run.pick(entry.deck, run.start(entry.deck), "left")
  await call("finish", { deckID, state: done })
  await call("save", { deckID, state: done })
  const { decks } = (await call("list", {})) as { decks: { status: string }[] }
  expect(decks[0]!.status).toBe("sent")
})

test("unknown decks are reported, not thrown", async () => {
  const { call } = await load()
  expect(await call("get", { deckID: "dk_missing" })).toEqual({ error: "not_found", message: "No deck with that ID." })
})

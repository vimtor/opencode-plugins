import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"

let externalTabs: typeof import("opencode-external-tabs/tui").default
beforeAll(async () => {
  externalTabs = (await import("opencode-external-tabs/tui")).default
})

const env = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, OPENCODE_CLI_CONFIG_CONTENT: process.env.OPENCODE_CLI_CONFIG_CONTENT }
let config: string
beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "opencode-external-tabs-config-"))
  delete process.env.OPENCODE_CLI_CONFIG_CONTENT
  config = join(process.env.XDG_CONFIG_HOME, "opencode", "cli.json")
  mkdirSync(dirname(config), { recursive: true })
})
afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

type Handler = (event: unknown) => void

async function setup(input: { location?: string; defaultLocation?: string; sessions?: Record<string, string> } = {}) {
  const handlers = new Map<string, Set<Handler>>()
  const opened: string[] = []
  const cleanup = await externalTabs.setup({
    options: {},
    location: input.location ? { directory: input.location } : undefined,
    data: {
      on: (type: string, handler: Handler) => {
        const set = handlers.get(type) ?? new Set()
        handlers.set(type, set.add(handler))
        return () => set.delete(handler)
      },
      location: { default: () => ({ directory: input.defaultLocation ?? "/default" }) },
      session: {
        get: (sessionID: string) => {
          const directory = input.sessions?.[sessionID]
          return directory ? { location: { directory } } : undefined
        },
      },
    },
    ui: {
      tabs: {
        open: (sessionID: string) => {
          opened.push(sessionID)
          return true
        },
        focus: () => {
          throw new Error("external tabs must not take focus")
        },
      },
    },
  } as unknown as Plugin.Context)
  const created = (data: { sessionID: string; directory: string; parentID?: string; metadata?: Record<string, unknown> }) => {
    for (const handler of handlers.get("session.created") ?? []) {
      handler({
        type: "session.created",
        data: { sessionID: data.sessionID, parentID: data.parentID, location: { directory: data.directory }, metadata: data.metadata },
      })
    }
  }
  const updated = (data: { sessionID: string; directory?: string; metadata: Record<string, unknown> }) => {
    for (const handler of handlers.get("session.metadata.updated") ?? []) {
      handler({
        type: "session.metadata.updated",
        location: data.directory ? { directory: data.directory } : undefined,
        data: { sessionID: data.sessionID, metadata: data.metadata },
      })
    }
  }
  return { opened, created, updated, cleanup: async () => { if (cleanup) await cleanup() }, handlers }
}

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-external-tabs/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", externalTabs)
})

test("opens root sessions created in the launch directory as background tabs", async () => {
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_sdk", directory: "/repo" })
  expect(opened).toEqual(["ses_sdk"])
})

test("falls back to the default location", async () => {
  const { opened, created } = await setup({ defaultLocation: "/home/repo" })
  created({ sessionID: "ses_other", directory: "/repo" })
  created({ sessionID: "ses_sdk", directory: "/home/repo" })
  expect(opened).toEqual(["ses_sdk"])
})

test("skips subagent sessions", async () => {
  writeFileSync(config, JSON.stringify({ tabs: { scope: "global" } }))
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_child", directory: "/repo", parentID: "ses_parent" })
  expect(opened).toEqual([])
})

test("skips other directories with the default cwd tab scope", async () => {
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_elsewhere", directory: "/other" })
  expect(opened).toEqual([])
})

test("opens sessions from any directory with the global tab scope", async () => {
  writeFileSync(config, `{\n  // comment\n  "tabs": { "scope": "global", },\n}\n`)
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_elsewhere", directory: "/other" })
  expect(opened).toEqual(["ses_elsewhere"])
})

test("prefers OPENCODE_CLI_CONFIG_CONTENT over cli.json", async () => {
  writeFileSync(config, JSON.stringify({ tabs: { scope: "global" } }))
  process.env.OPENCODE_CLI_CONFIG_CONTENT = JSON.stringify({ tabs: { scope: "cwd" } })
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_elsewhere", directory: "/other" })
  expect(opened).toEqual([])
})

test("follows tab scope changes without a restart", async () => {
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_before", directory: "/other" })
  writeFileSync(config, JSON.stringify({ tabs: { scope: "global" } }))
  created({ sessionID: "ses_after", directory: "/other" })
  expect(opened).toEqual(["ses_after"])
})

test("treats an invalid config as the default cwd scope", async () => {
  writeFileSync(config, "{ tabs: ")
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_elsewhere", directory: "/other" })
  created({ sessionID: "ses_sdk", directory: "/repo" })
  expect(opened).toEqual(["ses_sdk"])
})

test("skips sessions created with tab: false metadata", async () => {
  const { opened, created } = await setup({ location: "/repo" })
  created({ sessionID: "ses_job", directory: "/repo", metadata: { tab: false } })
  created({ sessionID: "ses_sdk", directory: "/repo", metadata: { other: true } })
  expect(opened).toEqual(["ses_sdk"])
})

test("opens a session when its metadata sets tab: true", async () => {
  const { opened, created, updated } = await setup({ location: "/repo" })
  created({ sessionID: "ses_job", directory: "/repo", metadata: { tab: false } })
  updated({ sessionID: "ses_job", directory: "/repo", metadata: { tab: false } })
  expect(opened).toEqual([])
  updated({ sessionID: "ses_job", directory: "/repo", metadata: { tab: true } })
  expect(opened).toEqual(["ses_job"])
})

test("applies the tab scope to metadata updates", async () => {
  const { opened, updated } = await setup({ location: "/repo", sessions: { ses_known: "/repo" } })
  updated({ sessionID: "ses_elsewhere", directory: "/other", metadata: { tab: true } })
  updated({ sessionID: "ses_known", metadata: { tab: true } })
  expect(opened).toEqual(["ses_known"])
  writeFileSync(config, JSON.stringify({ tabs: { scope: "global" } }))
  updated({ sessionID: "ses_elsewhere", directory: "/other", metadata: { tab: true } })
  expect(opened).toEqual(["ses_known", "ses_elsewhere"])
})

test("stops listening on cleanup", async () => {
  const { opened, created, cleanup, handlers } = await setup({ location: "/repo" })
  await cleanup()
  expect(handlers.get("session.created")?.size).toBe(0)
  expect(handlers.get("session.metadata.updated")?.size).toBe(0)
  created({ sessionID: "ses_sdk", directory: "/repo" })
  expect(opened).toEqual([])
})

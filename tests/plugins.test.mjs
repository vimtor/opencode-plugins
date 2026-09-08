import assert from "node:assert/strict"
import { dirname } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import exitPlan from "opencode-exit-plan"
import keepGoing from "opencode-keep-going/tui"
import quickLinks from "opencode-quick-links/tui"
import postgres from "opencode-postgres"
import mysql from "opencode-mysql"
import pg from "pg"
import mysqlDriver from "mysql2/promise"

test("CLI plugins load through local directories as well as npm exports", async () => {
  for (const [name, plugin] of [["opencode-quick-links", quickLinks], ["opencode-keep-going", keepGoing]]) {
    const directory = dirname(dirname(fileURLToPath(import.meta.resolve(`${name}/tui`))))
    const { tui } = Host.resolve({ directory })
    assert.ok(tui, `${name} must expose a local TUI entrypoint`)
    assert.equal((await Host.load(tui)).default, plugin)
  }
})

async function planHarness({ options = {}, agent = "plan", target = {} } = {}) {
  const switches = []
  const location = { directory: "/project/worktree" }
  let prompt
  await exitPlan.setup({
    options,
    session: {
      hook: async (name, callback) => {
        assert.equal(name, "prompt")
        prompt = callback
      },
      get: async () => ({ agent, location }),
      switchAgent: async (input) => { switches.push(input) },
    },
    agent: {
      list: async (input) => {
        assert.deepEqual(input, { location })
        return { data: [{ id: "build", name: "Builder", hidden: false, mode: "primary", ...target }] }
      },
    },
  })
  return { switches, prompt: (text) => prompt({ sessionID: "session", prompt: { text } }) }
}

test("Exit Plan switches by agent ID at the session location and preserves ordinary prompts", async () => {
  const harness = await planHarness()
  await harness.prompt("Explain the plan")
  assert.deepEqual(harness.switches, [])
  await harness.prompt("  GO   AHEAD  ")
  assert.deepEqual(harness.switches, [{ sessionID: "session", agent: "build" }])
})

test("Exit Plan respects custom phrases, target eligibility, and current agent", async () => {
  const custom = await planHarness({ options: { agent: "review", phrases: ["  READY  NOW "] }, target: { id: "review" } })
  await custom.prompt("go ahead")
  assert.deepEqual(custom.switches, [])
  await custom.prompt("ready now")
  assert.equal(custom.switches[0].agent, "review")

  for (const input of [{ agent: "build" }, { target: { hidden: true } }, { target: { mode: "subagent" } }, { target: { id: "other" } }]) {
    const harness = await planHarness(input)
    await harness.prompt("go ahead")
    assert.deepEqual(harness.switches, [])
  }
})

function keepGoingHarness(options = {}) {
  const calls = []
  const toasts = []
  const prompt = { sessionID: "session", mode: "normal" }
  const renderer = { currentFocusedEditor: { plainText: "" } }
  const route = { type: "session", sessionID: "session" }
  let layer
  let disposed = false
  const client = {
    synthetic: async (input) => { calls.push({ type: "synthetic", ...input }) },
    prompt: async (input) => { calls.push({ type: "prompt", ...input }) },
  }
  const cleanup = keepGoing.setup({
    options, renderer,
    client: { session: client },
    keymap: { layer: (get) => { layer = get() } },
    ui: {
      router: { current: () => route },
      toast: { show: (input) => toasts.push(input) },
      slot: (claim) => {
        assert.equal(claim.append, "prompt.footer")
        claim.render(prompt)
        return () => { disposed = true }
      },
    },
  })
  return { calls, toasts, client, prompt, renderer, route, layer, cleanup, disposed: () => disposed, run: () => layer.commands[0].run() }
}

test("Keep Going resumes with hidden synthetic messages or visible user prompts", async () => {
  for (const hidden of [true, false]) {
    const harness = keepGoingHarness({ hidden, message: "Proceed." })
    assert.equal(harness.layer.enabled(), true)
    await harness.run()
    assert.deepEqual(harness.calls, [{
      type: hidden ? "synthetic" : "prompt", sessionID: "session", text: "Proceed.",
      metadata: { source: "opencode-keep-going" }, resume: true,
    }])
    harness.cleanup()
    assert.equal(harness.disposed(), true)
  }
})

test("Keep Going falls through for non-empty input and stays out of shell/home composers", () => {
  const harness = keepGoingHarness()
  harness.renderer.currentFocusedEditor.plainText = "Explain this"
  assert.equal(harness.run(), false)
  harness.renderer.currentFocusedEditor = null
  assert.equal(harness.run(), false)
  harness.prompt.mode = "shell"
  assert.equal(harness.layer.enabled(), false)
  harness.prompt.mode = "normal"
  harness.prompt.sessionID = undefined
  assert.equal(harness.layer.enabled(), false)
  assert.deepEqual(harness.calls, [])
})

test("Keep Going reports failed admission and permits retry", async () => {
  const harness = keepGoingHarness()
  harness.client.synthetic = async () => { throw new Error("offline") }
  await harness.run()
  assert.equal(harness.toasts[0].variant, "error")
  harness.client.synthetic = async (input) => { harness.calls.push(input) }
  await harness.run()
  assert.equal(harness.calls.length, 1)
})

test("Keep Going suppresses repeated Enter while admission is pending", async () => {
  const harness = keepGoingHarness()
  let complete
  harness.client.synthetic = (input) => {
    harness.calls.push(input)
    return new Promise((resolve) => { complete = resolve })
  }
  const pending = harness.run()
  harness.run()
  assert.equal(harness.calls.length, 1)
  complete()
  await pending
})

test("Quick Links reads V2 user/assistant text, deduplicates URLs, and ignores tool/reasoning content", async () => {
  let command
  let dialog
  let render
  let mounted = false
  let disposed = false
  const messages = []
  const cleanup = quickLinks.setup({
    keymap: { layer: (get) => {
      assert.equal(mounted, true, "keymap registration requires a mounted UI context")
      command = get().commands[0]
    } },
    data: { session: { message: {
      sync: async (sessionID) => {
        assert.equal(sessionID, "session")
        messages.push(
          { type: "user", text: "See https://example.com/guide." },
          { type: "assistant", content: [
            { type: "text", text: "[Guide](https://example.com/guide) and https://example.com/page_(one)." },
            { type: "reasoning", text: "https://private.example/reasoning" },
            { type: "tool", state: { content: [{ type: "text", text: "https://private.example/tool" }] } },
          ] },
          { type: "synthetic", text: "https://private.example/synthetic" },
          { type: "system", text: "https://private.example/system" },
        )
      },
      list: () => messages,
    } } },
    ui: {
      slot: (claim) => {
        assert.equal(claim.append, "app")
        render = claim.render
        return () => { disposed = true }
      },
      router: { current: () => ({ type: "session", sessionID: "session" }) },
      toast: { show: (input) => assert.fail(input.message) },
      dialog: { select: async (input) => { dialog = input } },
    },
  })
  assert.equal(command, undefined)
  mounted = true
  render({})
  assert.equal(command.id, "quick-links.open")
  assert.equal(command.slash.name, "links")
  await command.run()
  assert.deepEqual(dialog.options.map((option) => option.value), ["https://example.com/guide", "https://example.com/page_(one)"])
  cleanup()
  assert.equal(disposed, true)
})

async function queryTool(plugin, options) {
  let tool
  await plugin.setup({ options, tool: { transform: async (transform) => transform({ add: (value) => { tool = value } }) } })
  return tool
}

test("Postgres preserves read-only transactions, structured results, and cleanup", async (t) => {
  const statements = []
  let ended = 0
  t.mock.method(pg.Client.prototype, "connect", async () => {})
  t.mock.method(pg.Client.prototype, "end", async () => { ended++ })
  t.mock.method(pg.Client.prototype, "query", async (query) => {
    statements.push(query)
    return { command: "SELECT", rowCount: 1, fields: [{ name: "answer" }], rows: [{ answer: 42 }] }
  })
  const tool = await queryTool(postgres, { connectionString: "postgres://localhost/test" })
  assert.equal(tool.options.permission, "postgres_query")
  const result = await tool.execute({ query: " SELECT 42 " }, { progress: async () => {} })
  assert.deepEqual(statements, ["BEGIN READ ONLY", { name: "opencode_postgres_query", text: "SELECT 42", values: [] }, "COMMIT"])
  assert.deepEqual(JSON.parse(result.content).results[0].rows, [{ answer: 42 }])
  assert.equal(ended, 1)
})

test("Postgres rolls back failed queries and always disconnects", async (t) => {
  const statements = []
  t.mock.method(pg.Client.prototype, "connect", async () => {})
  t.mock.method(pg.Client.prototype, "end", async () => { statements.push("END") })
  t.mock.method(pg.Client.prototype, "query", async (query) => {
    statements.push(query)
    if (typeof query === "object") throw new Error("query failed")
  })
  const tool = await queryTool(postgres, { connectionString: "postgres://localhost/test" })
  await assert.rejects(tool.execute({ query: "SELECT broken" }, { progress: async () => {} }), /query failed/)
  assert.deepEqual(statements.slice(-2), ["ROLLBACK", "END"])
})

test("MySQL disables multi-statements and preserves read-only transactions and cleanup", async (t) => {
  const statements = []
  let connectionOptions
  t.mock.method(mysqlDriver, "createConnection", async (options) => {
    connectionOptions = options
    return {
      query: async (query) => { statements.push(query); return [[{ answer: 42 }], [{ name: "answer" }]] },
      commit: async () => { statements.push("COMMIT") },
      rollback: async () => { statements.push("ROLLBACK") },
      end: async () => { statements.push("END") },
    }
  })
  const tool = await queryTool(mysql, { connectionString: "mysql://localhost/test?multipleStatements=true" })
  assert.equal(tool.options.permission, "mysql_query")
  const result = await tool.execute({ query: " SELECT 42 " }, { progress: async () => {} })
  assert.equal(connectionOptions.multipleStatements, false)
  assert.deepEqual(connectionOptions.flags, ["-MULTI_STATEMENTS"])
  assert.equal(new URL(connectionOptions.uri).searchParams.has("multipleStatements"), false)
  assert.deepEqual(statements, ["START TRANSACTION READ ONLY", "SELECT 42", "COMMIT", "END"])
  assert.deepEqual(JSON.parse(result.content), { fields: ["answer"], rows: [{ answer: 42 }] })
})

test("MySQL rolls back query failures and disconnects", async (t) => {
  const statements = []
  t.mock.method(mysqlDriver, "createConnection", async () => ({
    query: async (query) => {
      statements.push(query)
      if (query !== "START TRANSACTION READ ONLY") throw new Error("query failed")
    },
    rollback: async () => { statements.push("ROLLBACK") },
    end: async () => { statements.push("END") },
  }))
  const tool = await queryTool(mysql, { connectionString: "mysql://localhost/test" })
  await assert.rejects(tool.execute({ query: "SELECT broken" }, { progress: async () => {} }), /query failed/)
  assert.deepEqual(statements.slice(-2), ["ROLLBACK", "END"])
})

import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import postgres from "opencode-postgres"
import pg from "pg"

afterEach(() => mock.restore())

const context = {
  sessionID: "ses_test", agent: "build", messageID: "msg_test", id: "call_test",
  progress: async () => {},
} as unknown as ToolContext

async function queryTool(options: Record<string, unknown>) {
  let tool: Info | undefined
  await postgres.setup({
    options,
    tool: {
      transform: async (transform: (editor: Pick<ToolEditor, "add">) => void) => transform({ add: (value: Info) => { tool = value } }),
    },
  } as unknown as Plugin.Context)
  if (!tool) throw new Error("Postgres tool was not registered")
  return tool
}

test("preserves read-only transactions, structured results, and cleanup", async () => {
  const statements: Array<string | pg.QueryConfig> = []
  let ended = 0
  spyOn(pg.Client.prototype, "connect").mockImplementation(async function (this: pg.Client) { return this })
  spyOn(pg.Client.prototype, "end").mockImplementation(async () => { ended++ })
  spyOn(pg.Client.prototype, "query").mockImplementation((async (query: string | pg.QueryConfig) => {
    statements.push(query)
    return { command: "SELECT", rowCount: 1, fields: [{ name: "answer" }], rows: [{ answer: 42 }] } as pg.QueryResult
  }) as pg.Client["query"])
  const tool = await queryTool({ connectionString: "postgres://localhost/test" })
  expect(tool.options?.permission).toBe("postgres_query")
  const result = await tool.execute({ query: " SELECT 42 " }, context)
  expect(statements).toEqual(["BEGIN READ ONLY", { name: "opencode_postgres_query", text: "SELECT 42", values: [] }, "COMMIT"])
  if (typeof result.content !== "string") throw new Error("Expected JSON text content")
  expect(JSON.parse(result.content).results[0].rows).toEqual([{ answer: 42 }])
  expect(ended).toBe(1)
})

test("rolls back failed queries and always disconnects", async () => {
  const statements: Array<string | pg.QueryConfig> = []
  spyOn(pg.Client.prototype, "connect").mockImplementation(async function (this: pg.Client) { return this })
  spyOn(pg.Client.prototype, "end").mockImplementation(async () => { statements.push("END") })
  spyOn(pg.Client.prototype, "query").mockImplementation((async (query: string | pg.QueryConfig) => {
    statements.push(query)
    if (typeof query === "object") throw new Error("query failed")
    return { command: query, rowCount: 0, fields: [], rows: [] }
  }) as pg.Client["query"])
  const tool = await queryTool({ connectionString: "postgres://localhost/test" })
  await expect(tool.execute({ query: "SELECT broken" }, context)).rejects.toThrow("query failed")
  expect(statements.slice(-2)).toEqual(["ROLLBACK", "END"])
})

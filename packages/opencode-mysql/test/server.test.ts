import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import mysql from "opencode-mysql"
import mysqlDriver from "mysql2/promise"
import type { Connection, ConnectionOptions } from "mysql2/promise"

afterEach(() => mock.restore())

const context = {
  sessionID: "ses_test", agent: "build", messageID: "msg_test", id: "call_test",
  progress: async () => {},
} as unknown as ToolContext

async function queryTool(options: Record<string, unknown>) {
  let tool: Info | undefined
  await mysql.setup({
    options,
    tool: {
      transform: async (transform: (editor: Pick<ToolEditor, "add">) => void) => transform({ add: (value: Info) => { tool = value } }),
    },
  } as unknown as Plugin.Context)
  if (!tool) throw new Error("MySQL tool was not registered")
  return tool
}

test("disables multi-statements and preserves read-only transactions and cleanup", async () => {
  const statements: string[] = []
  let connectionOptions: ConnectionOptions | undefined
  spyOn(mysqlDriver, "createConnection").mockImplementation(async (options) => {
    if (typeof options === "string") throw new Error("Expected structured connection options")
    connectionOptions = options
    return {
      query: async (query: string) => { statements.push(query); return [[{ answer: 42 }], [{ name: "answer" }]] },
      commit: async () => { statements.push("COMMIT") },
      rollback: async () => { statements.push("ROLLBACK") },
      end: async () => { statements.push("END") },
    } as unknown as Connection
  })
  const tool = await queryTool({ connectionString: "mysql://localhost/test?multipleStatements=true" })
  expect(tool.options?.permission).toBe("mysql_query")
  const result = await tool.execute({ query: " SELECT 42 " }, context)
  if (!connectionOptions) throw new Error("MySQL connection was not created")
  expect(connectionOptions.multipleStatements).toBe(false)
  expect(connectionOptions.flags).toEqual(["-MULTI_STATEMENTS"])
  expect(new URL(connectionOptions.uri!).searchParams.has("multipleStatements")).toBe(false)
  expect(statements).toEqual(["START TRANSACTION READ ONLY", "SELECT 42", "COMMIT", "END"])
  if (typeof result.content !== "string") throw new Error("Expected JSON text content")
  expect(JSON.parse(result.content)).toEqual({ fields: ["answer"], rows: [{ answer: 42 }] })
})

test("rolls back query failures and disconnects", async () => {
  const statements: string[] = []
  spyOn(mysqlDriver, "createConnection").mockImplementation(async () => ({
    query: async (query: string) => {
      statements.push(query)
      if (query !== "START TRANSACTION READ ONLY") throw new Error("query failed")
    },
    rollback: async () => { statements.push("ROLLBACK") },
    end: async () => { statements.push("END") },
  } as unknown as Connection))
  const tool = await queryTool({ connectionString: "mysql://localhost/test" })
  await expect(tool.execute({ query: "SELECT broken" }, context)).rejects.toThrow("query failed")
  expect(statements.slice(-2)).toEqual(["ROLLBACK", "END"])
})

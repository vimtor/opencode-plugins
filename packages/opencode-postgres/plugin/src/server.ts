import { Plugin } from "@opencode/plugin"
import pg from "pg"
import type { QueryResult, QueryResultRow } from "pg"

type QueryResponse = QueryResult<QueryResultRow> | Array<QueryResult<QueryResultRow>>

const DEFAULT_READ_ONLY = true
const TOOL_ID = "postgres_query"
const TOOL_TITLE = "Postgres Query"

const { Client } = pg

function getConnectionString(options: Record<string, unknown>) {
  const connectionString = options.connectionString
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw new Error("opencode-postgres requires a non-empty connectionString option")
  }
  return connectionString
}

function getReadOnly(options: Record<string, unknown>) {
  const readOnly = options.readOnly
  if (readOnly === undefined) return DEFAULT_READ_ONLY
  if (typeof readOnly !== "boolean") {
    throw new Error("opencode-postgres readOnly option must be a boolean")
  }
  return readOnly
}

async function runQuery(connectionString: string, query: string, readOnly: boolean) {
  const client = new Client({ connectionString })

  await client.connect()
  try {
    if (!readOnly) return await client.query(query)

    await client.query("BEGIN READ ONLY")
    try {
      const result = await client.query({ name: "opencode_postgres_query", text: query, values: [] })
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    }
  } finally {
    await client.end()
  }
}

function serializeResult(result: QueryResult<QueryResultRow>) {
  return {
    command: result.command,
    rowCount: result.rowCount,
    fields: result.fields.map((field) => field.name),
    rows: result.rows,
  }
}

function serializeResponse(response: QueryResponse) {
  const results = Array.isArray(response) ? response : [response]

  return {
    statements: results.length,
    results: results.map(serializeResult),
  }
}

export default Plugin.define({
  id: "postgres",
  async setup(ctx) {
    const options = ctx.options
    const readOnly = getReadOnly(options)
    const mode = readOnly ? "read-only" : "read/write"

    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_ID,
        description: `Postgres Query (${mode}): run one SQL statement against the configured Postgres database.`,
        input: {
          type: "object",
          properties: {
            query: { type: "string", pattern: "\\S", description: "SQL statement to run in Postgres" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        options: { permission: TOOL_ID },
        async execute(input, context) {
          const query = (input as { query: string }).query.trim()
          if (!query) throw new Error("Postgres query must not be empty")
          await context.progress({ title: TOOL_TITLE, readOnly })

          const connectionString = getConnectionString(options)
          const response = await runQuery(connectionString, query, readOnly)
          const output = serializeResponse(response)

          return {
            content: JSON.stringify(output, null, 2),
            metadata: { title: TOOL_TITLE, readOnly, statements: output.statements },
          }
        },
      })
    })
  },
})

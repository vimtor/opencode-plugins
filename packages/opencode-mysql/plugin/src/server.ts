import { type PluginModule, tool } from "@opencode-ai/plugin"
import mysql, { type FieldPacket, type QueryResult, type ResultSetHeader } from "mysql2/promise"

const DEFAULT_READ_ONLY = true
const TOOL_ID = "mysql_query"
const TOOL_TITLE = "MySQL Query"

function getConnectionString(options: Record<string, unknown>) {
  const connectionString = options.connectionString
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw new Error("opencode-mysql requires a non-empty connectionString option")
  }
  return connectionString
}

function getReadOnly(options: Record<string, unknown>) {
  const readOnly = options.readOnly
  if (readOnly === undefined) return DEFAULT_READ_ONLY
  if (typeof readOnly !== "boolean") {
    throw new Error("opencode-mysql readOnly option must be a boolean")
  }
  return readOnly
}

async function runQuery(connectionString: string, query: string, readOnly: boolean) {
  const uri = new URL(connectionString)
  uri.searchParams.delete("multipleStatements")
  // mysql2 merges URI options, so blacklist the protocol capability too.
  const connection = await mysql.createConnection({
    uri: uri.toString(),
    multipleStatements: false,
    flags: ["-MULTI_STATEMENTS"],
  })

  try {
    if (!readOnly) return await connection.query<QueryResult>(query)

    await connection.query("START TRANSACTION READ ONLY")
    try {
      const response = await connection.query<QueryResult>(query)
      await connection.commit()
      return response
    } catch (error) {
      await connection.rollback().catch(() => undefined)
      throw error
    }
  } finally {
    await connection.end()
  }
}

function isResultSetHeader(result: QueryResult): result is ResultSetHeader {
  return !Array.isArray(result) && "affectedRows" in result
}

function serializeResponse([result, fields]: [QueryResult, FieldPacket[]]) {
  if (isResultSetHeader(result)) {
    return {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows,
      insertId: result.insertId,
      warnings: result.warningStatus,
      info: result.info,
    }
  }

  return {
    fields: fields.map((field) => field.name),
    rows: result,
  }
}

export default {
  id: "mysql",
  server: async (_ctx, options = {}) => {
    const readOnly = getReadOnly(options)
    const mode = readOnly ? "read-only" : "read/write"

    return {
      tool: {
        [TOOL_ID]: tool({
          description: `MySQL Query (${mode}): run one SQL statement against the configured MySQL database.`,
          args: {
            query: tool.schema.string().trim().min(1).describe("SQL statement to run in MySQL"),
          },
          async execute(args, context) {
            context.metadata({ title: TOOL_TITLE, metadata: { readOnly } })
            await context.ask({
              permission: TOOL_ID,
              patterns: [args.query],
              always: ["*"],
              metadata: {
                title: TOOL_TITLE,
                query: args.query,
                readOnly,
              },
            })

            const connectionString = getConnectionString(options)
            const response = await runQuery(connectionString, args.query, readOnly)
            const output = serializeResponse(response)

            return {
              title: TOOL_TITLE,
              output: JSON.stringify(output, null, 2),
              metadata: { readOnly },
            }
          },
        }),
      },
    }
  },
} satisfies PluginModule

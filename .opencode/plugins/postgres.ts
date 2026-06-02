import postgres from "../../packages/opencode-postgres/plugin/src/server.ts"

const localOptions = {
  connectionString: "postgresql://postgres:password@localhost:5432/development?schema=public",
  readOnly: true,
}

export default {
  ...postgres,
  server: ((input, options = {}) => postgres.server(input, { ...localOptions, ...options })) satisfies typeof postgres.server,
}

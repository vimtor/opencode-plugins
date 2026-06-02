import mysql from "../../packages/opencode-mysql/plugin/src/server.ts"

const localOptions = {
  connectionString: "mysql://root:password@localhost:3307/development",
  readOnly: true,
}

export default {
  ...mysql,
  server: ((input, options = {}) => mysql.server(input, { ...localOptions, ...options })) satisfies typeof mysql.server,
}

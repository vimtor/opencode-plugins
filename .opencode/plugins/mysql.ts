import mysql from "../../packages/opencode-mysql/plugin/src/server.ts"

const localOptions = {
  connectionString: "mysql://root:password@localhost:3307/development",
  readOnly: true,
}

export default {
  ...mysql,
  setup: (ctx) => mysql.setup({ ...ctx, options: { ...localOptions, ...ctx.options } }),
} satisfies typeof mysql

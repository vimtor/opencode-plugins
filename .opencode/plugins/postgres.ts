import postgres from "../../packages/opencode-postgres/plugin/src/server.ts"

const localOptions = {
  connectionString: "postgresql://postgres:password@localhost:5432/development?schema=public",
  readOnly: true,
}

export default {
  ...postgres,
  setup: (ctx) => postgres.setup({ ...ctx, options: { ...localOptions, ...ctx.options } }),
} satisfies typeof postgres

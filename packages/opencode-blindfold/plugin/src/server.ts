import { randomUUID } from "node:crypto"
import { Plugin } from "@opencode/plugin"
import { Error as ToolError, type Result } from "@opencode/plugin/promise/tool"
import { Redactor } from "./redact.js"
import { Blindfold } from "./rpc.js"

const NAMESPACE = "blindfold"
const REQUEST_TOOL = "request"
const GET_TOOL = "get"
const GET_TOOL_IDS = new Set([`${NAMESPACE}_${GET_TOOL}`, `${NAMESPACE}.${GET_TOOL}`])
const NAME_PATTERN = "^[A-Z_][A-Z0-9_]*$"
const DEFAULT_TIMEOUT = 10 * 60_000
const ACK_TIMEOUT = 5_000

type Answer = { status: "submitted"; value: string } | { status: "cancelled" | "timeout" | "unavailable" }
type Pending = { finish: (answer: Answer) => void; acknowledge: () => void }

function failure(name: string, status: Exclude<Answer["status"], "submitted">) {
  if (status === "cancelled") return `The user declined to provide ${name}.`
  if (status === "timeout") return `Timed out waiting for the user to provide ${name}.`
  return [
    `No OpenCode TUI with opencode-blindfold responded, so the user could not be asked for ${name}.`,
    "Ask the user to add opencode-blindfold to plugins in ~/.config/opencode/cli.json and restart the TUI.",
  ].join(" ")
}

type BlindfoldOptions = {
  env?: boolean
  timeout?: number
}

function getEnv(options: BlindfoldOptions) {
  if (options.env === undefined) return true
  if (typeof options.env !== "boolean") throw new Error("opencode-blindfold env option must be a boolean")
  return options.env
}

function getTimeout(options: BlindfoldOptions) {
  if (options.timeout === undefined) return DEFAULT_TIMEOUT
  if (typeof options.timeout !== "number" || !Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new Error("opencode-blindfold timeout option must be a positive number of milliseconds")
  }
  return options.timeout
}

function usage(names: string[], env: boolean) {
  const access = [
    "Call `tools.blindfold.get({ name })` inside Code Mode to use a value without returning it.",
    env ? "Shell commands receive each secret as an environment variable with the same name, e.g. `$NAME`." : undefined,
  ].filter(Boolean)
  return [
    `Blindfold secrets available: ${names.join(", ")}.`,
    ...access,
    "Never print, return, or write secret values; they are redacted from tool output.",
  ].join(" ")
}

export default Plugin.define({
  id: "blindfold",
  async setup(ctx) {
    const options = ctx.options as BlindfoldOptions
    const env = getEnv(options)
    const timeout = getTimeout(options)
    const redactor = new Redactor()
    const pending = new Map<string, Pending>()

    const rpc = await ctx.rpc.register(Blindfold, {
      submit: async (input) => {
        const { requestID, value } = input as { requestID: string; value: string }
        const request = pending.get(requestID)
        if (!request || value === "") return { accepted: false }
        request.finish({ status: "submitted", value })
        return { accepted: true }
      },
      ack: async (input) => {
        const request = pending.get((input as { requestID: string }).requestID)
        if (!request) return { accepted: false }
        request.acknowledge()
        return { accepted: true }
      },
      cancel: async (input) => {
        const request = pending.get((input as { requestID: string }).requestID)
        if (!request) return { accepted: false }
        request.finish({ status: "cancelled" })
        return { accepted: true }
      },
    })

    function ask(request: { sessionID: string; name: string; reason: string }) {
      const requestID = randomUUID()
      return new Promise<Answer>((resolve) => {
        let acknowledged = false
        const finish = (answer: Answer) => {
          if (!pending.delete(requestID)) return
          clearTimeout(timer)
          clearTimeout(ackTimer)
          resolve(answer)
          void rpc.events.emit("resolved", { requestID }).catch(() => undefined)
        }
        const timer = setTimeout(() => finish({ status: acknowledged ? "timeout" : "unavailable" }), timeout)
        const ackTimer = setTimeout(() => finish({ status: "unavailable" }), ACK_TIMEOUT)
        pending.set(requestID, {
          finish,
          acknowledge: () => {
            acknowledged = true
            clearTimeout(ackTimer)
          },
        })
        rpc.events.emit("requested", { requestID, ...request }).catch(() => finish({ status: "unavailable" }))
      })
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: NAMESPACE,
        description: "Secrets provided by the user without revealing their values to the agent.",
      })
      editor.add({
        name: REQUEST_TOOL,
        description: [
          "Ask the user for a secret value, such as an API token or password, without revealing it to you.",
          "The value is never returned; use it through `blindfold.get` in Code Mode or as a shell environment variable.",
        ].join(" "),
        input: {
          type: "object",
          properties: {
            name: {
              type: "string",
              pattern: NAME_PATTERN,
              description: "Environment-variable style name, e.g. GITHUB_TOKEN",
            },
            reason: { type: "string", minLength: 1, description: "Why the secret is needed, shown to the user" },
            replace: { type: "boolean", description: "Ask again even if the secret is already stored" },
          },
          required: ["name", "reason"],
          additionalProperties: false,
        },
        options: { namespace: NAMESPACE },
        async execute(input, context) {
          const { name, reason, replace } = input as { name: string; reason: string; replace?: boolean }
          if (!new RegExp(NAME_PATTERN).test(name)) throw new Error(`Secret name must match ${NAME_PATTERN}`)
          await context.progress({ title: `Secret ${name}` })

          if (!redactor.get(name) || replace) {
            const answer = await ask({ sessionID: context.sessionID, name, reason })
            if (answer.status !== "submitted") throw new Error(failure(name, answer.status))
            redactor.set(name, answer.value)
          }

          return {
            content: `Secret ${name} is stored. ${usage(redactor.names(), env)}`,
            metadata: { title: `Secret ${name}`, name },
          }
        },
      })
      editor.add({
        name: GET_TOOL,
        description: "Read a stored secret value. Use it directly in code; never return or log it.",
        input: {
          type: "object",
          properties: { name: { type: "string", pattern: NAME_PATTERN } },
          required: ["name"],
          additionalProperties: false,
        },
        options: { namespace: NAMESPACE, codemode: true },
        async execute(input) {
          const { name } = input as { name: string }
          const value = redactor.get(name)
          if (value === undefined) throw new Error(`No secret named ${name}. Request it with blindfold.request first.`)
          return { content: value }
        },
      })
    })

    await ctx.tool.hook("execute.after", (event) => {
      if (redactor.size === 0 || GET_TOOL_IDS.has(event.tool)) return
      if (event.status === "completed") {
        event.result = redactor.value(event.result as Record<string, unknown>) as Result
        return
      }
      const message = redactor.text(event.error.message)
      const metadata = redactor.value(event.error.metadata)
      if (message === event.error.message && metadata === event.error.metadata) return
      const cause = redactor.text(String(event.error.error)) === String(event.error.error) ? event.error.error : undefined
      event.error = new ToolError({ message, metadata, error: cause })
    })

    await ctx.session.hook("context", (event) => {
      if (redactor.size === 0) return
      event.messages = redactor.value(event.messages)
      event.system = redactor.value(event.system)
      event.system.push({ type: "text", text: usage(redactor.names(), env) })
    })

    // Last line of defense for requests that bypass the context hook, such as compaction and titles.
    await ctx.session.hook("http.request", async (event) => {
      if (redactor.size === 0 || !event.request.body) return
      const body = await event.request.clone().text()
      const redacted = redactor.text(body)
      if (redacted === body) return
      const headers = new Headers(event.request.headers)
      headers.delete("content-length")
      event.request = new Request(event.request, { body: redacted, headers })
    })

    if (env) {
      await ctx.shell.hook("create.before", (event) => {
        for (const [name, value] of redactor.entries()) event.env[name] = value
      })
    }

    return () => {
      for (const request of pending.values()) request.finish({ status: "unavailable" })
    }
  },
})

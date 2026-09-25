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

type Settings = {
  shell: { enabled: boolean; approve: boolean }
  codemode: { enabled: boolean }
  prompt: { timeout: number }
}

function group(options: Record<string, unknown>, key: string) {
  const value = options[key]
  if (value === undefined) return {}
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`opencode-blindfold ${key} option must be an object`)
  }
  return value as Record<string, unknown>
}

function boolean(options: Record<string, unknown>, key: string, name: string, fallback: boolean) {
  const value = options[name]
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new Error(`opencode-blindfold ${key}.${name} option must be a boolean`)
  return value
}

function getSettings(options: Record<string, unknown>): Settings {
  const shell = group(options, "shell")
  const codemode = group(options, "codemode")
  const prompt = group(options, "prompt")
  const timeout = prompt.timeout ?? DEFAULT_TIMEOUT
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("opencode-blindfold prompt.timeout option must be a positive number of milliseconds")
  }
  const settings = {
    shell: { enabled: boolean(shell, "shell", "enabled", true), approve: boolean(shell, "shell", "approve", true) },
    codemode: { enabled: boolean(codemode, "codemode", "enabled", true) },
    prompt: { timeout },
  }
  if (!settings.shell.enabled && !settings.codemode.enabled) {
    throw new Error("opencode-blindfold needs shell.enabled or codemode.enabled, otherwise secrets cannot be used")
  }
  return settings
}

// Secret names are environment-variable style, so a word match covers $NAME, ${NAME}, os.environ["NAME"], and so on.
function mentioned(names: string[], command: string) {
  return names.filter((name) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(command))
}

const NEVER_PRINT = "Never print, return, or write secret values; they are redacted from tool output."

function instructions(settings: Settings) {
  const how = settings.codemode.enabled
    ? "use Blindfold from Code Mode: `tools.blindfold.get({ name, reason })` asks the user privately if the secret isn't stored yet and returns it to the running code only."
    : "call the `blindfold_request` tool so the user can enter it privately."
  return [
    `When a task needs a secret such as an API key, token, or password, ${how}`,
    settings.codemode.enabled && settings.shell.enabled
      ? "If only shell commands need it, call `tools.blindfold.request({ name, reason })` instead."
      : undefined,
    "Never ask the user to paste secrets into the chat.",
    NEVER_PRINT,
  ].filter(Boolean).join(" ")
}

function shellUsage(settings: Settings) {
  if (!settings.shell.enabled) return []
  return [
    "Shell commands receive it as an environment variable only when the command names it; pass it explicitly to programs that expect another variable, e.g. `GH_TOKEN=\"$GITHUB_TOKEN\" gh api user`.",
    settings.shell.approve ? "The user must approve each such command." : undefined,
  ]
}

function requestDescription(settings: Settings) {
  return [
    "Ask the user for a secret value, such as an API token or password, without revealing it to you.",
    "The value is never returned.",
    ...shellUsage(settings),
    settings.codemode.enabled ? "When code needs the value, use `tools.blindfold.get({ name, reason })` instead." : undefined,
    "Output containing the value is redacted.",
  ].filter(Boolean).join(" ")
}

const GET_DESCRIPTION = [
  "Return a secret's value to the running code, asking the user for it first if it isn't stored.",
  "Use it directly in code, e.g. in a fetch header; never return or log it.",
].join(" ")

const NAME_INPUT = {
  type: "string",
  pattern: NAME_PATTERN,
  description: "Environment-variable style name, e.g. GITHUB_TOKEN",
} as const

export default Plugin.define({
  id: "blindfold",
  async setup(ctx) {
    const settings = getSettings(ctx.options)
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
        const timer = setTimeout(() => finish({ status: acknowledged ? "timeout" : "unavailable" }), settings.prompt.timeout)
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

    async function obtain(request: { sessionID: string; name: string; reason: string; replace?: boolean }) {
      const { name, reason, replace } = request
      if (!new RegExp(NAME_PATTERN).test(name)) throw new Error(`Secret name must match ${NAME_PATTERN}`)
      const stored = redactor.get(name)
      if (stored !== undefined && !replace) return stored
      const answer = await ask({ sessionID: request.sessionID, name, reason })
      if (answer.status !== "submitted") throw new Error(failure(name, answer.status))
      redactor.set(name, answer.value)
      return answer.value
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: NAMESPACE,
        description: "Secrets provided by the user without revealing their values to the agent.",
      })
      editor.add({
        name: REQUEST_TOOL,
        description: requestDescription(settings),
        input: {
          type: "object",
          properties: {
            name: NAME_INPUT,
            reason: { type: "string", minLength: 1, description: "Why the secret is needed, shown to the user" },
            replace: { type: "boolean", description: "Ask again even if the secret is already stored" },
          },
          required: ["name", "reason"],
          additionalProperties: false,
        },
        // Code Mode is preferred when enabled; otherwise the agent needs a regular tool to request secrets at all.
        options: settings.codemode.enabled
          ? { namespace: NAMESPACE, codemode: true, pinned: true }
          : { namespace: NAMESPACE, codemode: false },
        async execute(input, context) {
          const { name, reason, replace } = input as { name: string; reason: string; replace?: boolean }
          await context.progress({ title: `Secret ${name}` })
          await obtain({ sessionID: context.sessionID, name, reason, replace })
          return {
            content: `Secret ${name} is stored. Blindfold secrets available: ${redactor.names().join(", ")}. ${NEVER_PRINT}`,
            metadata: { title: `Secret ${name}`, name },
          }
        },
      })
      if (!settings.codemode.enabled) return
      editor.add({
        name: GET_TOOL,
        description: GET_DESCRIPTION,
        input: {
          type: "object",
          properties: {
            name: NAME_INPUT,
            reason: { type: "string", minLength: 1, description: "Why the secret is needed, shown to the user if it must be requested" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        options: { namespace: NAMESPACE, codemode: true, pinned: true },
        async execute(input, context) {
          const { name, reason } = input as { name: string; reason?: string }
          return { content: await obtain({ sessionID: context.sessionID, name, reason: reason ?? `The agent needs ${name}.` }) }
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

    const system = instructions(settings)
    await ctx.session.hook("context", (event) => {
      if (redactor.size > 0) {
        event.messages = redactor.value(event.messages)
        event.system = redactor.value(event.system)
      }
      event.system.push({ type: "text", text: system })
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

    if (settings.shell.enabled) {
      // Commands can only read secrets they name, so naming one is what triggers approval.
      if (settings.shell.approve) {
        await ctx.permission.hook("evaluate", (event) => {
          if (event.action !== "shell" || event.effect === "deny") return
          const names = [...new Set(event.resources.flatMap((command) => mentioned(redactor.names(), command)))]
          if (names.length === 0) return
          event.effect = "ask"
          event.message = `This command can read ${names.join(", ")}`
        })
      }
      await ctx.shell.hook("create.before", (event) => {
        for (const name of mentioned(redactor.names(), event.command)) event.env[name] = redactor.get(name)
      })
    }

    return () => {
      for (const request of pending.values()) request.finish({ status: "unavailable" })
    }
  },
})

import { Plugin } from "@opencode/plugin"

type Ref = { providerID: string; id: string; variant?: string }
type Scope = (typeof SCOPES)[number]
type Item = { type: "prompt"; text: string } | { type: "tool"; name: string; input: unknown } | { type: "reply"; text: string }
type Verdict = { block: false } | { block: true; reason: string }
type Message = Awaited<ReturnType<Plugin.Context["session"]["context"]>>[number]

const SCOPES = ["prompts", "tools", "replies"] as const
const TIMEOUT = 30_000
const HISTORY = 10
const MAX_CHARS = 2_000

export default Plugin.define({
  id: "supervisor",
  async setup(ctx) {
    const options = parseOptions(ctx.options)
    // Each user prompt starts a new turn, so verdicts that arrive late can't stop a later run.
    const turns = new Map<string, number>()
    const stopped = new Map<string, number>()
    const turn = (sessionID: string) => turns.get(sessionID) ?? 0

    async function review(sessionID: string, item: Item): Promise<Verdict> {
      try {
        const history = await transcript(sessionID)
        const prompt = buildPrompt(options.instructions, history, item)
        const result = await withTimeout(ctx.generate.text({ model: options.model, prompt }), TIMEOUT)
        const verdict = parseVerdict(result.text)
        if (!verdict) throw new Error(`unreadable verdict: ${truncate(result.text, 200)}`)
        return verdict
      } catch (error) {
        console.error(`opencode-supervisor: review failed (${describe(error)})`)
        if (options.fallback === "allow") return { block: false }
        return { block: true, reason: `the supervisor could not review it (${describe(error)})` }
      }
    }

    async function transcript(sessionID: string) {
      const messages = await ctx.session.context({ sessionID })
      return messages.slice(-HISTORY).flatMap(format).join("\n")
    }

    async function stop(sessionID: string, reason: string, at: number) {
      if (turn(sessionID) !== at || stopped.get(sessionID) === at) return
      stopped.set(sessionID, at)
      const result = await ctx.session.interrupt({ sessionID })
      await notify(sessionID, `Supervisor ${result?.interrupted === false ? "flagged the last turn" : "stopped the run"}: ${reason}`)
    }

    function notify(sessionID: string, text: string) {
      return ctx.session.synthetic({ sessionID, text, description: text, resume: false })
    }

    // Streaming mode reviews in the background and can only stop the run once a verdict arrives.
    function watch(sessionID: string, item: Item) {
      const at = turn(sessionID)
      if (stopped.get(sessionID) === at) return
      review(sessionID, item)
        .then((verdict) => (verdict.block ? stop(sessionID, verdict.reason, at) : undefined))
        .catch((error) => console.error(`opencode-supervisor: ${describe(error)}`))
    }

    await ctx.session.hook("prompt", async (event) => {
      turns.set(event.sessionID, turn(event.sessionID) + 1)
      if (!options.scope.has("prompts")) return
      const item: Item = { type: "prompt", text: event.prompt.text }
      if (options.mode === "streaming") return watch(event.sessionID, item)
      const verdict = await review(event.sessionID, item)
      if (!verdict.block) return
      if (options.action === "stop") await ctx.session.interrupt({ sessionID: event.sessionID })
      await notify(event.sessionID, `Supervisor blocked a prompt: ${verdict.reason}`)
      // Prompt hooks can't reject cleanly; throwing keeps the prompt out of the session.
      throw new Error(`Supervisor blocked this prompt: ${verdict.reason}`)
    })

    if (options.scope.has("tools")) {
      await ctx.tool.hook("execute.before", async (event) => {
        if (options.ignore.has(event.tool)) return
        const item: Item = { type: "tool", name: event.tool, input: event.input }
        if (options.mode === "streaming") return watch(event.sessionID, item)
        const at = turn(event.sessionID)
        if (stopped.get(event.sessionID) === at) throw new Error("Supervisor stopped this run")
        const verdict = await review(event.sessionID, item)
        if (!verdict.block) return
        if (options.action === "stop") await stop(event.sessionID, verdict.reason, at)
        throw new Error(`Supervisor blocked this tool call: ${verdict.reason}`)
      })
    }

    if (!options.scope.has("replies")) return

    // Replies stream to the user as they're generated, so both modes review them after each text block.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.text.ended") continue
        if (event.location && event.location.directory !== ctx.location.directory) continue
        if (!event.data.text.trim()) continue
        watch(event.data.sessionID, { type: "reply", text: event.data.text })
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.error(`opencode-supervisor: ${describe(error)}`)
    })
    return () => controller.abort()
  },
})

function parseOptions(options: Readonly<Record<string, unknown>>) {
  const model = parseRef(options.model)
  if (!model) throw new Error('opencode-supervisor model option must be "provider/model" with an optional "#variant"')
  if (typeof options.instructions !== "string" || !options.instructions.trim())
    throw new Error("opencode-supervisor instructions option must be a non-empty string")
  const scope = options.scope ?? SCOPES
  if (!Array.isArray(scope) || !scope.every((value) => SCOPES.includes(value)))
    throw new Error(`opencode-supervisor scope option must list any of ${SCOPES.join(", ")}`)
  const ignore = options.ignore ?? []
  if (!Array.isArray(ignore) || !ignore.every((value) => typeof value === "string"))
    throw new Error("opencode-supervisor ignore option must be a list of tool names")
  return {
    model,
    instructions: options.instructions.trim(),
    mode: oneOf("mode", options.mode, ["blocking", "streaming"]),
    action: oneOf("action", options.action, ["stop", "deny"]),
    scope: new Set<Scope>(scope),
    ignore: new Set<string>(ignore),
    fallback: oneOf("fallback", options.fallback, ["allow", "block"]),
  }
}

// The first value is the default.
function oneOf<const T extends string>(name: string, value: unknown, values: readonly [T, ...T[]]): T {
  if (value === undefined) return values[0]
  if (values.includes(value as T)) return value as T
  throw new Error(`opencode-supervisor ${name} option must be one of ${values.join(", ")}`)
}

function buildPrompt(instructions: string, history: string, item: Item) {
  return [
    "You supervise an AI coding agent's session. Decide whether the item under review breaks the instructions below.",
    "Only block clear violations. Use the conversation for context, but judge only the item under review.",
    "",
    "<instructions>",
    instructions,
    "</instructions>",
    "",
    "<conversation>",
    history || "(empty)",
    "</conversation>",
    "",
    `<review type="${item.type}"${item.type === "tool" ? ` tool="${item.name}"` : ""}>`,
    truncate(item.type === "tool" ? stringify(item.input) : item.text, MAX_CHARS * 4),
    "</review>",
    "",
    'Reply with JSON only: {"verdict":"allow"} or {"verdict":"block","reason":"<one sentence naming the broken instruction>"}',
  ].join("\n")
}

function format(message: Message): string[] {
  switch (message.type) {
    case "user":
      return [`User: ${truncate(message.text, MAX_CHARS)}`]
    case "synthetic":
      return [`Notice: ${truncate(message.text, MAX_CHARS)}`]
    case "assistant":
      return message.content.flatMap((part) => {
        if (part.type === "text") return [`Assistant: ${truncate(part.text, MAX_CHARS)}`]
        if (part.type === "tool") return [`Tool call ${part.name}: ${truncate(stringify(part.state.input), MAX_CHARS)}`]
        return []
      })
    default:
      return []
  }
}

function parseVerdict(text: string): Verdict | undefined {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return
  try {
    const value = JSON.parse(json) as { verdict?: unknown; reason?: unknown }
    if (value.verdict === "allow") return { block: false }
    if (value.verdict !== "block") return
    const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : "no reason given"
    return { block: true, reason }
  } catch {
    return
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function stringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function parseRef(value: unknown): Ref | undefined {
  if (typeof value !== "string") return
  const input = value.trim()
  const slash = input.indexOf("/")
  if (slash <= 0) return
  const hash = input.indexOf("#", slash + 1)
  const id = input.slice(slash + 1, hash === -1 ? undefined : hash)
  const variant = hash === -1 ? undefined : input.slice(hash + 1)
  if (!id || variant === "") return
  return { providerID: input.slice(0, slash), id, ...(variant ? { variant } : {}) }
}

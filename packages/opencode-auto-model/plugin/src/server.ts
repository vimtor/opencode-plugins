import { Model, Plugin, Provider } from "@opencode/plugin"

type ModelInfo = Awaited<ReturnType<Plugin.Context["model"]["list"]>>["data"][number]
type Ref = { providerID: string; id: string; variant?: string }
type Candidate = { key: string; model: ModelInfo; variant?: string; description: string }
type Decision = { key?: string; effort?: string }
type Decider = (input: {
  sessionID: string
  text: string
  candidates: Candidate[]
  efforts: string[]
}) => Promise<Decision>

const PROVIDER_ID = "router"
const MODEL_ID = "auto"

const JEV = {
  opencode: { url: "https://opencode.ai/inference/systemone/v1/systemone", model: "jev-1.13" },
  openrouter: { url: "https://openrouter.ai/api/v1/systemone", model: "typesafe/jev-1.14" },
}

// Tried in order when Jev is unavailable. Matched by model ID under any provider.
const FAST_MODELS = [
  "gpt-6-luna",
  "claude-haiku-5-5",
  "gemini-3.5-flash-lite",
  "gpt-5.6-luna",
  "gpt-5.4-nano",
  "claude-haiku-4-5",
  "gemini-3-flash",
]

// Ordered from least to most reasoning.
const EFFORTS: Record<string, string> = {
  none: "No reasoning: greetings, lookups, or one-line answers",
  minimal: "Almost no reasoning: simple questions or tiny edits",
  low: "Light reasoning: small, well-defined edits or explanations",
  medium: "Moderate reasoning: routine features, fixes, or refactors",
  high: "Deep reasoning: hard debugging, multi-file changes, or design work",
  xhigh: "Very deep reasoning: complex architecture or subtle bugs",
  max: "Maximum reasoning: the hardest problems, regardless of cost or latency",
}

const INSTRUCTIONS = "Pick the cheapest model that can handle this coding agent request well."
const MAX_OPTIONS = 255
const MAX_STATE = 8_000
const JEV_TIMEOUT = 10_000
const LLM_TIMEOUT = 20_000

export default Plugin.define({
  id: "auto-model",
  async setup(ctx) {
    const models = modelOptions(ctx.options.models)
    const fallback = parseRef(ctx.options.fallback)
    const decider = parseRef(ctx.options.decider)
    const routing = new Map<string, Promise<void>>()

    await ctx.provider.transform((providers) => {
      const providerID = Provider.ID.make(PROVIDER_ID)
      providers.add({
        info: {
          id: providerID,
          name: "Model Router",
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          // Never called: sessions switch to the picked model before their first request.
          settings: { baseURL: "http://127.0.0.1:9/v1", apiKey: "" },
        },
        models: [{ ...Model.Info.default(providerID, Model.ID.make(MODEL_ID)), name: "Auto" }],
      })
    })

    await ctx.session.hook("prompt", async (event) => {
      const sessionID = String(event.sessionID)
      let pending = routing.get(sessionID)
      if (!pending) {
        pending = route(sessionID, event.prompt.text)
          .catch((error) => console.error("opencode-auto-model:", error))
          .finally(() => routing.delete(sessionID))
        routing.set(sessionID, pending)
      }
      await pending
    })

    async function route(sessionID: string, text: string) {
      const session = await ctx.session.get({ sessionID })
      const current = session.model ?? (await ctx.model.default()).data ?? undefined
      if (!current || current.providerID !== PROVIDER_ID) return
      const available = (await ctx.model.list()).data.filter((model) => model.providerID !== PROVIDER_ID)
      const model = session.parentID
        ? ((await parentModel(session.parentID)) ?? pickFallback(available, candidates(available)))
        : await choose(sessionID, text, available)
      if (!model) throw new Error("no model available to route to")
      await ctx.session.switchModel({ sessionID, model })
    }

    // Subagents run on their parent's model instead of routing on their own.
    async function parentModel(parentID: string) {
      const parent = await ctx.session.get({ sessionID: parentID })
      if (!parent.model || parent.model.providerID === PROVIDER_ID) return
      return toRef(parent.model)
    }

    async function choose(sessionID: string, text: string, available: ModelInfo[]) {
      const options = candidates(available)
      if (options.length === 0) return pickFallback(available, options)
      const efforts = effortOptions(options)
      if (options.length === 1 && efforts.length <= 1) return select(options[0]!)
      const decide = await findDecider(available)
      if (!decide) return pickFallback(available, options)
      const decision = await decide({ sessionID, text, candidates: options, efforts }).catch((error) => {
        console.error("opencode-auto-model: decider failed:", error)
        return undefined
      })
      const picked = options.find((option) => option.key === decision?.key)
      if (!picked) return pickFallback(available, options)
      return select(picked, efforts.length > 1 && efforts.includes(decision?.effort ?? "") ? decision?.effort : undefined)
    }

    function candidates(available: ModelInfo[]): Candidate[] {
      if (!models) {
        return available
          .filter(
            (model) =>
              model.enabled &&
              model.status !== "deprecated" &&
              model.capabilities.tools &&
              (model.capabilities.output.length === 0 ||
                model.capabilities.output.some((output) => output.startsWith("text"))),
          )
          .sort((a, b) => b.time.released - a.time.released)
          .slice(0, MAX_OPTIONS)
          .map((model) => ({ key: formatRef(model), model, description: describe(model) }))
      }
      return models.flatMap(([key, description]) => {
        const ref = parseRef(key)
        const model = ref && findModel(available, ref)
        if (!ref || !model) return []
        if (ref.variant && !model.variants.some((variant) => variant.id === ref.variant)) return []
        return [{ key, model, variant: ref.variant, description: description || describe(model) }]
      }).slice(0, MAX_OPTIONS)
    }

    function pickFallback(available: ModelInfo[], options: Candidate[]): Ref | undefined {
      const model = fallback && findModel(available, fallback)
      if (fallback && model && (!fallback.variant || model.variants.some((v) => v.id === fallback.variant)))
        return fallback
      if (options[0]) return select(options[0])
      const first = available[0]
      return first && toRef(first)
    }

    async function findDecider(available: ModelInfo[]): Promise<Decider | undefined> {
      if (decider) {
        if (decider.providerID === "opencode" && decider.id.startsWith("jev-")) {
          const credential = await credentials("opencode")
          return credential && jev({ ...JEV.opencode, model: decider.id }, credential)
        }
        if (decider.providerID === "openrouter" && decider.id.startsWith("typesafe/jev-")) {
          const credential = await credentials("openrouter")
          return credential && jev({ ...JEV.openrouter, model: decider.id }, credential)
        }
        return llm(decider)
      }
      const opencode = await credentials("opencode")
      if (opencode) return jev(JEV.opencode, opencode)
      const openrouter = await credentials("openrouter")
      if (openrouter) return jev(JEV.openrouter, openrouter)
      for (const id of FAST_MODELS) {
        const model = available.find((item) => item.enabled && (item.id === id || item.id.endsWith(`/${id}`)))
        if (!model) continue
        const variant = ["none", "minimal", "low"].find((effort) => model.variants.some((v) => v.id === effort))
        return llm({ ...toRef(model), variant })
      }
    }

    async function credentials(integrationID: string) {
      const connection = await ctx.integration.connection.active(integrationID).catch(() => undefined)
      if (!connection) return
      const credential = await ctx.integration.connection.resolve(connection).catch(() => undefined)
      if (!credential || credential.type === "external") return
      const orgID = credential.metadata?.orgID
      return {
        token: credential.type === "oauth" ? credential.access : credential.key,
        orgID: typeof orgID === "string" ? orgID : undefined,
      }
    }

    function jev(endpoint: { url: string; model: string }, credential: { token: string; orgID?: string }): Decider {
      return async ({ sessionID, text, candidates, efforts }) => {
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${credential.token}`,
            "x-opencode-session": sessionID,
            ...(credential.orgID ? { "x-opencode-org-id": credential.orgID } : {}),
          },
          body: JSON.stringify({
            model: endpoint.model,
            state: text.slice(0, MAX_STATE) || "(empty request)",
            questions: {
              model: {
                type: "choice",
                instructions: INSTRUCTIONS,
                criteria: Object.fromEntries(candidates.map((option) => [option.key, option.description])),
              },
              ...(efforts.length > 1
                ? {
                    effort: {
                      type: "choice",
                      instructions: "How much reasoning effort does this request need?",
                      criteria: Object.fromEntries(efforts.map((effort) => [effort, EFFORTS[effort]])),
                    },
                  }
                : {}),
            },
          }),
          signal: AbortSignal.timeout(JEV_TIMEOUT),
        })
        if (!response.ok) throw new Error(`Jev returned ${response.status}: ${await response.text()}`)
        const data = (await response.json()) as { answers?: Record<string, { choice?: unknown }> }
        const choice = (id: string) => {
          const value = data.answers?.[id]?.choice
          return typeof value === "string" ? value : undefined
        }
        return { key: choice("model"), effort: choice("effort") }
      }
    }

    function llm(model: Ref): Decider {
      return async ({ text, candidates, efforts }) => {
        const prompt = [
          `You route a coding agent's first request to a model. ${INSTRUCTIONS}`,
          `<request>\n${text.slice(0, MAX_STATE)}\n</request>`,
          `Models:\n${candidates.map((option) => `- ${option.key}: ${option.description}`).join("\n")}`,
          ...(efforts.length > 1
            ? [`Reasoning efforts:\n${efforts.map((effort) => `- ${effort}: ${EFFORTS[effort]}`).join("\n")}`]
            : []),
          `Reply with JSON only: {"model": "<model>"${efforts.length > 1 ? ', "effort": "<effort>"' : ""}}`,
        ].join("\n\n")
        const result = await ctx.generate.text({ prompt, model }, { signal: AbortSignal.timeout(LLM_TIMEOUT) })
        return parseDecision(result.text, candidates)
      }
    }
  },
})

function select(option: Candidate, effort?: string): Ref {
  return { ...toRef(option.model), variant: option.variant ?? closestEffort(option.model, effort) }
}

// Uses the requested effort, or the model's nearest effort variant when it lacks that one.
function closestEffort(model: ModelInfo, effort: string | undefined) {
  if (!effort) return
  const order = Object.keys(EFFORTS)
  const target = order.indexOf(effort)
  const variants = model.variants.map((variant) => String(variant.id)).filter((id) => order.includes(id))
  return variants.reduce<string | undefined>((best, id) => {
    if (best === undefined) return id
    return Math.abs(order.indexOf(id) - target) < Math.abs(order.indexOf(best) - target) ? id : best
  }, undefined)
}

function effortOptions(options: Candidate[]) {
  const ids = new Set(
    options.filter((option) => !option.variant).flatMap((option) => option.model.variants.map((v) => String(v.id))),
  )
  return Object.keys(EFFORTS).filter((effort) => ids.has(effort))
}

function parseDecision(text: string, candidates: Candidate[]): Decision {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (json) {
    try {
      const value = JSON.parse(json) as { model?: unknown; effort?: unknown }
      return {
        key: typeof value.model === "string" ? value.model.trim() : undefined,
        effort: typeof value.effort === "string" ? value.effort.trim() : undefined,
      }
    } catch {}
  }
  const key = candidates
    .map((option) => option.key)
    .sort((a, b) => b.length - a.length)
    .find((key) => text.includes(key))
  return { key }
}

function describe(model: ModelInfo) {
  const cost = model.cost[0]
  return [
    model.name,
    cost && `$${Number(cost.input)}/M input tokens, $${Number(cost.output)}/M output tokens`,
    `${Math.round(model.limit.context / 1000)}k context`,
  ]
    .filter(Boolean)
    .join(". ")
}

function findModel(available: ModelInfo[], ref: Ref) {
  return available.find((model) => model.providerID === ref.providerID && model.id === ref.id)
}

function toRef(model: { providerID: string; id: string; variant?: string }): Ref {
  return {
    providerID: String(model.providerID),
    id: String(model.id),
    ...(model.variant ? { variant: String(model.variant) } : {}),
  }
}

function formatRef(model: { providerID: string; id: string }) {
  return `${model.providerID}/${model.id}`
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

function modelOptions(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  const entries = Object.entries(value).flatMap(([key, description]) =>
    parseRef(key) ? [[key.trim(), typeof description === "string" ? description.trim() : ""] as const] : [],
  )
  return entries.length > 0 ? entries : undefined
}

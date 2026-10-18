import { Plugin } from "@opencode/plugin"

type ModelInfo = Awaited<ReturnType<Plugin.Context["model"]["list"]>>["data"][number]
type Ref = { providerID: string; id: string; variant?: string }

export default Plugin.define({
  id: "fallback-model",
  async setup(ctx) {
    const chain = Array.isArray(ctx.options.models) ? ctx.options.models.flatMap((value) => parseRef(value) ?? []) : []
    if (chain.length === 0) return

    await ctx.session.hook("retry", async (event) => {
      const current = toRef(event.model)
      const available = (await ctx.model.list()).data
      const next = nextModel(current, available)
      if (!next) return
      await ctx.session.switchModel({ sessionID: event.sessionID, model: next })
      event.decision = { retry: true, delay: 0 }
      console.error(
        `opencode-fallback-model: ${formatRef(current)} failed (${event.error.message}), switching to ${formatRef(next)}`,
      )
    })

    // Walks forward from the failed model's place in the chain, so each fallback is tried at most once.
    function nextModel(current: Ref, available: ModelInfo[]) {
      const index = chain.findIndex((ref) => matches(ref, current))
      return chain
        .slice(index + 1)
        .find((ref) => !matches(ref, current) && isAvailable(ref, available))
    }
  },
})

// A reference without a variant matches every variant of its model.
function matches(ref: Ref, model: Ref) {
  return ref.providerID === model.providerID && ref.id === model.id && (!ref.variant || ref.variant === model.variant)
}

function isAvailable(ref: Ref, available: ModelInfo[]) {
  const model = available.find((item) => item.providerID === ref.providerID && item.id === ref.id)
  if (!model?.enabled) return false
  return !ref.variant || model.variants.some((variant) => variant.id === ref.variant)
}

function toRef(model: { providerID: string; id: string; variant?: string }): Ref {
  return {
    providerID: String(model.providerID),
    id: String(model.id),
    ...(model.variant ? { variant: String(model.variant) } : {}),
  }
}

function formatRef(ref: Ref) {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
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

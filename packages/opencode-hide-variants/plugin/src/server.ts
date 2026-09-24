import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "hide-variants",
  async setup(ctx) {
    const global = strings(ctx.options.variants)
    const models = modelRules(ctx.options.models)
    if (global.length === 0 && models.length === 0) return

    await ctx.model.transform((editor) => {
      editor.list().forEach((model) => {
        // DeepMutable turns branded IDs into structural string lookalikes.
        const providerID = String(model.providerID)
        const modelID = String(model.id)
        const hidden = new Set([
          ...global,
          ...models
            .filter((rule) => rule.id === modelID || rule.id === `${providerID}/${modelID}`)
            .flatMap((rule) => rule.variants),
        ])
        if (!model.variants.some((variant) => hidden.has(String(variant.id)))) return
        editor.update(providerID, modelID, (draft) => {
          draft.variants = draft.variants.filter((variant) => !hidden.has(String(variant.id)))
        })
      })
    })
  },
})

function modelRules(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([id, variants]) =>
    id.trim() ? [{ id: id.trim(), variants: strings(variants) }] : [],
  )
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
}

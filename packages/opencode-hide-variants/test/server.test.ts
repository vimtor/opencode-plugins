import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import hideVariants from "opencode-hide-variants"

type Editor = Parameters<Parameters<Plugin.Context["model"]["transform"]>[0]>[0]
type Model = { providerID: string; id: string; variants: { id: string }[] }

async function run(options: Record<string, unknown>, models: Model[]) {
  let transform: ((editor: Editor) => void) | undefined
  await hideVariants.setup({
    options,
    model: {
      transform: async (callback: (editor: Editor) => void) => {
        transform = callback
        return { dispose: async () => {} }
      },
    },
  } as unknown as Plugin.Context)
  const updated: string[] = []
  transform?.({
    list: () => models,
    update: (providerID: string, modelID: string, update: (model: Model) => void) => {
      const model = models.find((item) => item.providerID === providerID && item.id === modelID)
      if (!model) return
      updated.push(`${providerID}/${modelID}`)
      update(model)
    },
  } as unknown as Editor)
  return {
    registered: transform !== undefined,
    updated,
    variants: Object.fromEntries(
      models.map((model) => [`${model.providerID}/${model.id}`, model.variants.map((variant) => variant.id)]),
    ),
  }
}

const catalog = (): Model[] => [
  { providerID: "openai", id: "gpt-5.5", variants: ["none", "low", "medium", "high", "xhigh"].map((id) => ({ id })) },
  { providerID: "anthropic", id: "claude-opus-4-7", variants: ["low", "medium", "high", "max"].map((id) => ({ id })) },
  { providerID: "openrouter", id: "gpt-5.5", variants: ["low", "high"].map((id) => ({ id })) },
]

test("hides global variants from every model", async () => {
  const result = await run({ variants: ["none", " low "] }, catalog())
  expect(result.variants).toEqual({
    "openai/gpt-5.5": ["medium", "high", "xhigh"],
    "anthropic/claude-opus-4-7": ["medium", "high", "max"],
    "openrouter/gpt-5.5": ["high"],
  })
})

test("hides model variants by provider reference or bare model ID", async () => {
  const result = await run(
    {
      variants: ["none"],
      models: {
        "anthropic/claude-opus-4-7": ["low", "max"],
        "gpt-5.5": ["xhigh"],
        "openai/gpt-5.5": ["medium"],
      },
    },
    catalog(),
  )
  expect(result.variants).toEqual({
    "openai/gpt-5.5": ["low", "high"],
    "anthropic/claude-opus-4-7": ["medium", "high"],
    "openrouter/gpt-5.5": ["low", "high"],
  })
})

test("skips unaffected models and ignores invalid options", async () => {
  const result = await run(
    { variants: ["max", 1, ""], models: { "": ["low"], "openai/gpt-5.5": "low" } },
    catalog(),
  )
  expect(result.updated).toEqual(["anthropic/claude-opus-4-7"])
  expect(result.variants["openai/gpt-5.5"]).toEqual(["none", "low", "medium", "high", "xhigh"])

  const list = await run({ models: [{ id: "openai/gpt-5.5", variants: ["low"] }] }, catalog())
  expect(list.registered).toBe(false)

  const empty = await run({}, catalog())
  expect(empty.registered).toBe(false)
})

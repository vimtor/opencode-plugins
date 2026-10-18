import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import fallbackModel from "opencode-fallback-model"

type Ref = { providerID: string; id: string; variant?: string }
type Decision = { retry: false } | { retry: true; delay: number }

const model = (providerID: string, id: string, variants: string[] = [], enabled = true) => ({
  providerID,
  id,
  enabled,
  variants: variants.map((variant) => ({ id: variant })),
})

const catalog = () => [
  model("anthropic", "claude-opus-4-7", ["low", "high"]),
  model("openai", "gpt-5.5", ["low", "high"]),
  model("google", "gemini-3-pro"),
  model("xai", "grok-5", [], false),
]

async function setup(options: Record<string, unknown>, models = catalog()) {
  const switched: Ref[] = []
  let hook: ((event: any) => Promise<void>) | undefined
  await fallbackModel.setup({
    options,
    session: {
      hook: async (name: string, callback: typeof hook) => {
        if (name === "retry") hook = callback
        return { dispose: async () => {} }
      },
      switchModel: async ({ model }: { sessionID: string; model: Ref }) => {
        switched.push(model)
      },
    },
    model: { list: async () => ({ data: models }) },
  } as unknown as Plugin.Context)
  return {
    registered: hook !== undefined,
    switched,
    async fail(model: Ref, decision: Decision = { retry: false }) {
      const event = {
        sessionID: "ses_a",
        agent: "build",
        model,
        attempt: 2,
        error: { type: "api", message: "overloaded" },
        decision,
      }
      await hook!(event)
      return event.decision
    },
  }
}

const opus = { providerID: "anthropic", id: "claude-opus-4-7", variant: "high" }

test("does nothing without models", async () => {
  expect((await setup({})).registered).toBe(false)
})

test("switches to the first fallback and retries immediately", async () => {
  const harness = await setup({ models: ["openai/gpt-5.5#high", "google/gemini-3-pro"] })
  expect(await harness.fail(opus)).toEqual({ retry: true, delay: 0 })
  expect(harness.switched).toEqual([{ providerID: "openai", id: "gpt-5.5", variant: "high" }])
})

test("overrides retries of the same model", async () => {
  const harness = await setup({ models: ["google/gemini-3-pro"] })
  expect(await harness.fail(opus, { retry: true, delay: 4000 })).toEqual({ retry: true, delay: 0 })
  expect(harness.switched).toEqual([{ providerID: "google", id: "gemini-3-pro" }])
})

test("moves down the chain when a fallback fails", async () => {
  const harness = await setup({ models: ["openai/gpt-5.5#high", "google/gemini-3-pro"] })
  await harness.fail({ providerID: "openai", id: "gpt-5.5", variant: "high" })
  expect(harness.switched).toEqual([{ providerID: "google", id: "gemini-3-pro" }])
})

test("keeps the default decision when the last fallback fails", async () => {
  const harness = await setup({ models: ["openai/gpt-5.5#high", "google/gemini-3-pro"] })
  expect(await harness.fail({ providerID: "google", id: "gemini-3-pro" })).toEqual({ retry: false })
  expect(harness.switched).toEqual([])
})

test("skips unavailable, disabled, and unknown-variant fallbacks", async () => {
  const harness = await setup({
    models: ["mistral/large", "xai/grok-5", "openai/gpt-5.5#max", "invalid", "openai/gpt-5.5"],
  })
  await harness.fail(opus)
  expect(harness.switched).toEqual([{ providerID: "openai", id: "gpt-5.5" }])
})

test("a fallback without a variant matches every variant of the failed model", async () => {
  const harness = await setup({ models: ["anthropic/claude-opus-4-7", "google/gemini-3-pro"] })
  await harness.fail(opus)
  expect(harness.switched).toEqual([{ providerID: "google", id: "gemini-3-pro" }])
})

test("tries another variant of the same model", async () => {
  const harness = await setup({ models: ["anthropic/claude-opus-4-7#high", "anthropic/claude-opus-4-7#low"] })
  await harness.fail(opus)
  expect(harness.switched).toEqual([{ providerID: "anthropic", id: "claude-opus-4-7", variant: "low" }])
})

import { expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"
import keepGoing from "opencode-keep-going/tui"

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-keep-going/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", keepGoing)
})

type PromptInput = Parameters<Plugin.Context["client"]["session"]["prompt"]>[0]

async function keepGoingHarness(options: { hidden?: boolean; message?: string } = {}) {
  const calls: Array<PromptInput & { type?: "synthetic" | "prompt" }> = []
  const toasts: ToastOptions[] = []
  const prompt: { sessionID?: string; mode: "normal" | "shell"; showDetails: boolean } = { sessionID: "session", mode: "normal", showDetails: true }
  const renderer: { currentFocusedEditor: { plainText: string } | null } = { currentFocusedEditor: { plainText: "" } }
  const route = { type: "session", sessionID: "session" }
  let layer!: KeymapLayer
  let disposed = false
  const client = {
    synthetic: async (input: PromptInput) => { calls.push({ type: "synthetic", ...input }) },
    prompt: async (input: PromptInput) => { calls.push({ type: "prompt", ...input }) },
  }
  const cleanup = await keepGoing.setup({
    options, renderer,
    client: { session: client },
    keymap: { layer: (get: () => KeymapLayer) => { layer = get() } },
    ui: {
      router: { current: () => route },
      toast: { show: (input: ToastOptions) => toasts.push(input) },
      slot: (claim: SlotClaim<"prompt.footer">) => {
        expect(claim.append).toBe("prompt.footer")
        claim.render(prompt)
        return () => { disposed = true }
      },
    },
  } as unknown as Plugin.Context)
  return {
    calls, toasts, client, prompt, renderer,
    cleanup: async () => { if (cleanup) await cleanup() },
    disposed: () => disposed,
    enabled: () => typeof layer.enabled === "function" ? layer.enabled() : layer.enabled !== false,
    run: () => layer.commands![0].run(),
  }
}

test("resumes with hidden synthetic messages or visible user prompts", async () => {
  for (const hidden of [true, false]) {
    const harness = await keepGoingHarness({ hidden, message: "Proceed." })
    expect(harness.enabled()).toBe(true)
    await harness.run()
    expect(harness.calls).toEqual([{
      type: hidden ? "synthetic" : "prompt", sessionID: "session", text: "Proceed.",
      metadata: { source: "opencode-keep-going" }, resume: true,
    }])
    await harness.cleanup()
    expect(harness.disposed()).toBe(true)
  }
})

test("falls through for non-empty input and stays out of shell/home composers", async () => {
  const harness = await keepGoingHarness()
  harness.renderer.currentFocusedEditor!.plainText = "Explain this"
  expect(harness.run()).toBe(false)
  harness.renderer.currentFocusedEditor = null
  expect(harness.run()).toBe(false)
  harness.prompt.mode = "shell"
  expect(harness.enabled()).toBe(false)
  harness.prompt.mode = "normal"
  harness.prompt.sessionID = undefined
  expect(harness.enabled()).toBe(false)
  expect(harness.calls).toEqual([])
})

test("reports failed admission and permits retry", async () => {
  const harness = await keepGoingHarness()
  harness.client.synthetic = async () => { throw new Error("offline") }
  await harness.run()
  expect(harness.toasts[0].variant).toBe("error")
  harness.client.synthetic = async (input) => { harness.calls.push(input) }
  await harness.run()
  expect(harness.calls).toHaveLength(1)
})

test("suppresses repeated Enter while admission is pending", async () => {
  const harness = await keepGoingHarness()
  let complete!: () => void
  harness.client.synthetic = (input) => {
    harness.calls.push(input)
    return new Promise<void>((resolve) => { complete = resolve })
  }
  const pending = harness.run()
  harness.run()
  expect(harness.calls).toHaveLength(1)
  complete()
  await pending
})

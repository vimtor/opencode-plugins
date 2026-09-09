import { afterEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand, KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"
import quickLinks from "opencode-quick-links/tui"

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-quick-links/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", quickLinks)
})

test("reads user/assistant text, deduplicates URLs, and ignores tool/reasoning content", async () => {
  let command: KeymapCommand | undefined
  let dialogCommands: readonly KeymapCommand[] = []
  const view = await createTestRenderer({ width: 80, height: 24 })
  cleanups.push(() => view.renderer.destroy())
  let render!: SlotClaim<"app">["render"]
  let mounted = false
  let disposed = false
  const messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]> = []
  const cleanup = await quickLinks.setup({
    renderer: view.renderer,
    theme: {
      text: { default: "#ffffff", subdued: "#aaaaaa" },
      background: { action: { primary: { focused: "#333333" } } },
    },
    keymap: { layer: (get: () => KeymapLayer) => {
      expect(mounted).toBe(true)
      const layer = get()
      if (layer.target) dialogCommands = layer.commands ?? []
      else command = layer.commands?.[0]
    } },
    data: { session: { message: {
      sync: async (sessionID: string) => {
        expect(sessionID).toBe("session")
        messages.push(
          { id: "user", time: { created: 0 }, type: "user", text: "See https://example.com/guide." },
          { id: "assistant", time: { created: 0 }, type: "assistant", agent: "build", model: { providerID: "test", id: "test" }, content: [
            { type: "text", text: "[Guide](https://example.com/guide) and https://example.com/page_(one)." },
            { type: "text", text: "**[PR](https://github.com/anomalyco/opencode-console/pull/2090)**" },
            { type: "text", text: "[Guide](https://example.com/guide)follow-up(foo) **https://example.com/guide**" },
            { type: "text", text: "**[Nested](https://example.com/page_(one_(two))/details)**" },
            { type: "reasoning", text: "https://private.example/reasoning" },
            { type: "tool", id: "tool", name: "test", time: { created: 0 }, state: { status: "completed", input: {}, content: [{ type: "text", text: "https://private.example/tool" }] } },
          ] },
          { id: "synthetic", time: { created: 0 }, type: "synthetic", text: "https://private.example/synthetic" },
          { id: "system", time: { created: 0 }, type: "system", text: "https://private.example/system" },
        )
      },
      list: () => messages,
    } } },
    ui: {
      slot: (claim: SlotClaim<"app">) => {
        expect(claim.append).toBe("app")
        render = claim.render
        return () => { disposed = true }
      },
      router: { current: () => ({ type: "session", sessionID: "session" }) },
      toast: { show: (input: ToastOptions) => { throw new Error(input.message) } },
      dialog: {
        set: () => {},
        show: (render: () => ReturnType<SlotClaim<"app">["render"]>, close: () => void) => {
          createRoot((dispose) => {
            cleanups.push(dispose)
            view.renderer.root.add(render())
          })
          close()
        },
      },
    },
  } as unknown as Plugin.Context)
  expect(command).toBeUndefined()
  mounted = true
  render({})
  if (!command) throw new Error("Quick Links command was not registered")
  expect(command.id).toBe("quick-links.open")
  expect(command.slash?.name).toBe("links")
  await command.run()
  await view.flush()
  const frame = view.captureCharFrame()
  expect(frame).toContain("Search links in the conversation")
  expect(frame.match(/example.com\/guide/g)).toHaveLength(1)
  expect(frame).toContain("example.com/page_(one)")
  expect(frame).toContain("github.com/anomalyco/opencode-console/pull/2090")
  expect(frame).toContain("example.com/page_(one_(two))/details")
  expect(frame).not.toContain("https://")
  expect(frame).not.toContain("private.example")
  const footer = frame.split("\n").find((line) => line.includes("ctrl+y"))!
  expect(footer).toMatch(/Copy ctrl\+y\s+Open enter\s*$/)
  expect(dialogCommands.map((item) => item.bind)).toEqual(["up", "down", "return", "ctrl+y"])
  const input = view.renderer.currentFocusedEditor as InputRenderable
  input.value = "pull/2090"
  input.emit("input", input.value)
  await view.flush()
  expect(view.captureCharFrame()).toContain("github.com/anomalyco/opencode-console/pull/2090")
  expect(view.captureCharFrame()).not.toContain("example.com/guide")
  input.value = "no-such-link"
  input.emit("input", input.value)
  await view.flush()
  expect(view.captureCharFrame()).toContain("No matching links")
  await dialogCommands.find((item) => item.bind === "ctrl+y")!.run()
  await dialogCommands.find((item) => item.bind === "return")!.run()
  if (cleanup) await cleanup()
  expect(disposed).toBe(true)
})

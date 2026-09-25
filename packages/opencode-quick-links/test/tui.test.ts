import { expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogSelectOptions, KeymapCommand, KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"
import quickLinks from "opencode-quick-links/tui"

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-quick-links/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", quickLinks)
})

test.each([
  { label: "no shortcut by default", options: {}, bind: false },
  { label: "configured shortcut", options: { keybind: "ctrl+shift+o" }, bind: "ctrl+shift+o" },
  { label: "different shortcut", options: { keybind: "alt+l" }, bind: "alt+l" },
  { label: "disabled shortcut", options: { keybind: false }, bind: false },
  { label: "none shortcut", options: { keybind: "none" }, bind: false },
])("reads and deduplicates conversation links with $label", async ({ options, bind }) => {
  let command: KeymapCommand | undefined
  let dialog: DialogSelectOptions<string> | undefined
  let render!: SlotClaim<"app">["render"]
  let mounted = false
  let disposed = false
  const messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]> = []
  const cleanup = await quickLinks.setup({
    options,
    keymap: { layer: (get: () => KeymapLayer) => {
      expect(mounted).toBe(true)
      command = get().commands?.[0]
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
            { type: "tool", id: "tool", name: "test", time: { created: 0 }, state: { status: "completed", input: {}, content: [{ type: "text", text: "https://example.com/tool https://example.com/guide" }] } },
            { type: "tool", id: "failed", name: "test", time: { created: 0 }, state: { status: "error", input: {}, error: { type: "test", message: "failed" }, content: [{ type: "text", text: "https://example.com/error" }] } },
            { type: "tool", id: "running", name: "test", time: { created: 0 }, state: { status: "running", input: { url: "https://private.example/input" }, metadata: {} } },
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
      dialog: { select: async (input: DialogSelectOptions<string>) => { dialog = input } },
    },
  } as unknown as Plugin.Context)
  expect(command).toBeUndefined()
  mounted = true
  render({})
  if (!command) throw new Error("Quick Links command was not registered")
  expect(command.id).toBe("quick-links.open")
  expect(command.bind).toBe(bind)
  expect(command.slash?.name).toBe("links")
  await command.run()
  expect(dialog?.placeholder).toBe("Search links in the conversation")
  expect(dialog?.options[0]).toEqual({
    title: "example.com/error",
    value: "https://example.com/error",
  })
  expect(dialog?.options.map((option) => option.value)).toEqual([
    "https://example.com/error",
    "https://example.com/guide",
    "https://example.com/tool",
    "https://example.com/page_(one_(two))/details",
    "https://github.com/anomalyco/opencode-console/pull/2090",
    "https://example.com/page_(one)",
  ])
  if (cleanup) await cleanup()
  expect(disposed).toBe(true)
})

test.each([true, 42, "", "   "])("rejects invalid keybind option %p", (keybind) => {
  expect(() => quickLinks.setup({ options: { keybind } } as unknown as Plugin.Context)).toThrow(
    "opencode-quick-links keybind option must be a non-empty string or false",
  )
})

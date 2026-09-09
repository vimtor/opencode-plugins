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

test("reads user/assistant text, deduplicates URLs, and ignores tool/reasoning content", async () => {
  let command: KeymapCommand | undefined
  let dialog: DialogSelectOptions<string> | undefined
  let render!: SlotClaim<"app">["render"]
  let mounted = false
  let disposed = false
  const messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]> = []
  const cleanup = await quickLinks.setup({
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
      dialog: { select: async (input: DialogSelectOptions<string>) => { dialog = input } },
    },
  } as unknown as Plugin.Context)
  expect(command).toBeUndefined()
  mounted = true
  render({})
  if (!command) throw new Error("Quick Links command was not registered")
  expect(command.id).toBe("quick-links.open")
  expect(command.slash?.name).toBe("links")
  await command.run()
  expect(dialog?.placeholder).toBe("Search links in the conversation")
  expect(dialog?.options[0]).toEqual({
    title: "example.com",
    description: "/guide",
    value: "https://example.com/guide",
  })
  expect(dialog?.options.map((option) => option.value)).toEqual([
    "https://example.com/guide",
    "https://example.com/page_(one)",
    "https://github.com/anomalyco/opencode-console/pull/2090",
    "https://example.com/page_(one_(two))/details",
  ])
  if (cleanup) await cleanup()
  expect(disposed).toBe(true)
})

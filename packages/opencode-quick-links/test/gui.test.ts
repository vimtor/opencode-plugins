import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Command, Plugin, SelectOptions, SetupContext, ToastOptions } from "@opencode/plugin/gui"
import { createRoot } from "solid-js"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-quick-links/tui"))))
  const { gui } = Host.resolve({ directory })
  if (!gui) throw new Error("Missing GUI entrypoint")
  const provided: Record<string, unknown> = {
    "solid-js": await import("solid-js"),
    "@opencode/plugin/gui": await import("@opencode/plugin/gui"),
  }
  const module = { exports: {} as { default?: Plugin.Definition } }
  const require = (id: string) => {
    if (id in provided) return provided[id]
    throw new Error(`The app does not provide ${id}`)
  }
  new Function("module", "exports", "require", readFileSync(fileURLToPath(gui), "utf8"))(module, module.exports, require)
  if (!module.exports.default?.setup) throw new Error("Missing GUI setup")
  return module.exports.default.setup
}

const setup = await load()

const conversation = [
  { id: "user", type: "user", text: "See https://example.com/guide." },
  {
    id: "assistant",
    type: "assistant",
    content: [
      { type: "text", text: "[Guide](https://example.com/guide) and https://example.com/page_(one)." },
      { type: "reasoning", text: "https://private.example/reasoning" },
      { type: "tool", state: { status: "completed", content: [{ type: "text", text: "https://example.com/tool" }] } },
    ],
  },
]

function mount(input: { options?: Record<string, unknown>; messages?: unknown[]; session?: boolean; pick?: string } = {}) {
  const commands: Command[] = []
  const toasts: ToastOptions[] = []
  const dialogs: SelectOptions<string>[] = []
  const opened: string[] = []
  const synced: string[] = []
  const messages: unknown[] = []
  const data = {
    session: {
      message: {
        sync: async (id: string) => {
          synced.push(id)
          messages.push(...(input.messages ?? conversation))
        },
        list: () => messages,
      },
    },
  }
  const ctx = {
    options: input.options ?? {},
    add: (_registry: unknown, item: Command) => commands.push(item),
    sessions: { current: () => (input.session === false ? undefined : { id: "ses_a", server: { data } }) },
    toast: { show: (toast: ToastOptions) => toasts.push(toast) },
    dialogs: {
      select: async (options: SelectOptions<string>) => {
        dialogs.push(options)
        return input.pick
      },
    },
    system: { openExternal: (url: string) => opened.push(url) },
  } as unknown as SetupContext<{}>
  createRoot(() => setup(ctx))
  const command = commands[0]!
  return { command, toasts, dialogs, opened, synced, run: async () => void (await command.run()) }
}

test("adds the command with a /links slash command", () => {
  expect(mount().command).toMatchObject({ id: "open", title: "Open session links", slash: { name: "links" }, bind: undefined })
  expect(mount({ options: { keybind: "ctrl+shift+o" } }).command.bind).toBe("ctrl+shift+o")
  expect(mount({ options: { keybind: "none" } }).command.bind).toBeUndefined()
  expect(() => mount({ options: { keybind: 1 } })).toThrow("opencode-quick-links keybind option must be a non-empty string or false")
})

test("lists the session's text links, newest first, and opens the pick", async () => {
  const { run, dialogs, opened, synced } = mount({ pick: "https://example.com/guide" })
  await run()
  expect(synced).toEqual(["ses_a"])
  expect(dialogs).toEqual([
    {
      title: "Quick Links",
      placeholder: "Search links in the conversation",
      options: [
        { title: "example.com/page_(one)", value: "https://example.com/page_(one)" },
        { title: "example.com/guide", value: "https://example.com/guide" },
      ],
    },
  ])
  expect(opened).toEqual(["https://example.com/guide"])
})

test("opens nothing when the dialog is dismissed", async () => {
  const { run, opened } = mount()
  await run()
  expect(opened).toEqual([])
})

test("explains when there is nothing to list", async () => {
  const empty = mount({ messages: [{ id: "user", type: "user", text: "no links" }] })
  await empty.run()
  expect(empty.dialogs).toEqual([])
  expect(empty.toasts).toEqual([{ title: "No links found in this session." }])
  const home = mount({ session: false })
  await home.run()
  expect(home.toasts).toEqual([{ title: "Start a session." }])
})

import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Command, ComposerQuote, Plugin, SelectOptions, SetupContext, ToastOptions } from "@opencode/plugin/gui"
import { createRoot } from "solid-js"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-quick-quote/tui"))))
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

const reply = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] })
const conversation = [
  { type: "user", text: "first" },
  reply("Old paragraph."),
  { type: "user", text: "second" },
  reply("Use the **cache**.\n\n- Delete  the\nlock file"),
  { type: "synthetic", text: "background task finished" },
  reply("Then run the tests."),
]

function mount(input: { messages?: unknown[]; pick?: (options: SelectOptions<string>) => string | undefined; quotable?: boolean } = {}) {
  const commands: Command[] = []
  const toasts: ToastOptions[] = []
  const dialogs: SelectOptions<string>[] = []
  const attached: ComposerQuote[] = []
  const focused: (string | undefined)[] = []
  const state = { session: { key: "sidecar\nses_a" } as { key: string } | undefined }
  const data = { session: { message: { sync: async () => {}, list: () => input.messages ?? conversation } } }
  const composer = {
    quotable: () => input.quotable ?? true,
    attach: (part: ComposerQuote) => attached.push(part),
    focus: (commentID?: string) => focused.push(commentID),
  }
  const ctx = {
    options: {},
    add: (_registry: unknown, item: Command) => commands.push(item),
    sessions: { current: () => state.session && { ...state.session, id: "ses_a", server: { data } } },
    screen: { current: () => (state.session ? { composer } : undefined) },
    toast: { show: (toast: ToastOptions) => toasts.push(toast) },
    dialogs: {
      select: async (options: SelectOptions<string>) => {
        dialogs.push(options)
        return input.pick?.(options)
      },
    },
  } as unknown as SetupContext<{}>
  createRoot(() => setup(ctx))
  const command = commands[0]!
  return { command, toasts, dialogs, attached, focused, state, run: async (query?: string) => void (await command.run(query)) }
}

test("adds a /quote slash command that takes a search", () => {
  expect(mount().command).toMatchObject({ id: "quote", slash: { name: "quote", arguments: true } })
})

test("lists the paragraphs of the latest reply group and attaches the pick as a quote", async () => {
  const { run, dialogs, attached, focused } = mount({ pick: (options) => options.options[1]!.value })
  await run()
  expect(dialogs[0]!.options).toEqual([
    { title: "Use the **cache**.", value: "Use the **cache**." },
    { title: "- Delete the lock file", value: "- Delete  the\nlock file" },
    { title: "Then run the tests.", value: "Then run the tests." },
  ])
  expect(attached).toEqual([
    {
      type: "quote",
      commentID: expect.any(String),
      text: "- Delete  the\nlock file",
      source: { label: "Reply", icon: "outline-quote", subject: "the assistant's reply" },
    },
  ])
  expect(focused).toEqual([attached[0]!.commentID])
})

test("filters by the text after /quote", async () => {
  const { run, dialogs } = mount()
  await run(" tests ")
  expect(dialogs[0]!.options.map((option) => option.value)).toEqual(["Then run the tests."])
})

test("explains when there is nothing to quote", async () => {
  const empty = mount({ messages: [{ type: "user", text: "hi" }] })
  await empty.run()
  expect(empty.toasts).toEqual([{ title: "No reply to quote yet." }])
  const unmatched = mount()
  await unmatched.run("nothing like this")
  expect(unmatched.toasts).toEqual([{ title: "No matching paragraphs." }])
  const shell = mount({ quotable: false })
  await shell.run()
  expect(shell.toasts).toEqual([{ title: "This prompt can't take quotes." }])
  expect([empty, unmatched, shell].flatMap((mounted) => mounted.dialogs)).toEqual([])
})

test("attaches nothing when the dialog is dismissed or the session changed", async () => {
  const dismissed = mount()
  await dismissed.run()
  expect(dismissed.attached).toEqual([])
  const moved = mount({
    pick: (options) => {
      moved.state.session = { key: "sidecar\nses_b" }
      return options.options[0]!.value
    },
  })
  await moved.run()
  expect(moved.attached).toEqual([])
})

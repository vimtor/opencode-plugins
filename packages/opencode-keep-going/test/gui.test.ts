import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Command, Plugin, SetupContext, ToastOptions } from "@opencode/plugin/gui"
import { createRoot } from "solid-js"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-keep-going/tui"))))
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

function mount(options: Record<string, unknown> = {}) {
  const calls: { type: string; input: unknown }[] = []
  const toasts: ToastOptions[] = []
  const commands: Command[] = []
  const composer = { text: "", focused: true, quotable: true }
  const state: { session?: object; fail?: boolean; pending?: Promise<void> } = {}
  const call = (type: string) => async (input: unknown) => {
    calls.push({ type, input })
    if (state.fail) throw new Error("offline")
    await state.pending
  }
  state.session = { id: "ses_a", server: { client: { session: { synthetic: call("synthetic"), prompt: call("prompt") } } } }
  const ctx = {
    options,
    add: (_registry: unknown, item: Command) => commands.push(item),
    sessions: { current: () => state.session },
    screen: {
      current: () =>
        state.session && {
          composer: { text: () => composer.text, focused: () => composer.focused, quotable: () => composer.quotable },
        },
    },
    toast: { show: (toast: ToastOptions) => toasts.push(toast) },
  } as unknown as SetupContext<{}>
  createRoot(() => setup(ctx))
  const command = commands[0]!
  return { calls, toasts, composer, state, command, run: () => command.run() }
}

test("binds Enter in the prompt without listing the command", () => {
  const { command } = mount()
  expect(command).toMatchObject({ id: "send", bind: "enter", editable: true, hidden: true })
})

test("sends a hidden continue message on an empty prompt", async () => {
  const { calls, run } = mount()
  expect(run()).toBeUndefined()
  await Bun.sleep(0)
  expect(calls).toEqual([
    {
      type: "synthetic",
      input: { sessionID: "ses_a", text: "Continue.", metadata: { source: "opencode-keep-going" }, resume: true },
    },
  ])
})

test("sends a visible prompt with hidden false and a custom message", async () => {
  const { calls, run } = mount({ hidden: false, message: "Keep going." })
  run()
  await Bun.sleep(0)
  expect(calls).toMatchObject([{ type: "prompt", input: { text: "Keep going." } }])
})

test("hands Enter back when the prompt has text, lost focus, is in shell mode, or there is no session", () => {
  const { calls, composer, state, run } = mount()
  composer.text = "fix the bug"
  expect(run()).toBe(false)
  composer.text = "  "
  composer.focused = false
  expect(run()).toBe(false)
  composer.focused = true
  composer.quotable = false
  expect(run()).toBe(false)
  composer.quotable = true
  state.session = undefined
  expect(run()).toBe(false)
  expect(calls).toEqual([])
})

test("sends once while a send is in flight", async () => {
  const { calls, state, run } = mount()
  let release!: () => void
  state.pending = new Promise((resolve) => (release = resolve))
  run()
  run()
  expect(calls).toHaveLength(1)
  release()
  await Bun.sleep(0)
  run()
  expect(calls).toHaveLength(2)
})

test("shows a toast when the send fails", async () => {
  const { toasts, state, run } = mount()
  state.fail = true
  run()
  await Bun.sleep(0)
  expect(toasts).toEqual([{ variant: "error", title: "Could not continue the session." }])
})

test.each([
  [{ hidden: "yes" }, "opencode-keep-going hidden option must be a boolean"],
  [{ message: " " }, "opencode-keep-going message option must be a non-empty string"],
])("rejects invalid options %p", (options, error) => {
  expect(() => mount(options)).toThrow(error)
})

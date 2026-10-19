import { expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogPromptOptions, DialogSelectOptions, KeymapCommand, KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"
import blindfold from "opencode-blindfold/tui"

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-blindfold/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", blindfold)
})

type Listener = (event: { data: Record<string, unknown>; location: unknown }) => unknown

async function harness(answers: Array<string | undefined>) {
  const listeners = new Map<string, Listener>()
  const calls: Array<[string, unknown, unknown]> = []
  const prompts: DialogPromptOptions[] = []
  const toasts: ToastOptions[] = []
  let cleared = 0
  let pending: ((value: string | undefined) => void) | undefined
  const cleanup = await blindfold.setup({
    client: {
      rpc: () => ({
        ack: async () => ({ accepted: true }),
        submit: async (input: unknown, options: unknown) => { calls.push(["submit", input, options]); return { accepted: true } },
        cancel: async (input: unknown, options: unknown) => { calls.push(["cancel", input, options]); return { accepted: true } },
        events: { on: (name: string, listener: Listener) => { listeners.set(name, listener); return () => listeners.delete(name) } },
      }),
    },
    ui: {
      dialog: {
        prompt: (options: DialogPromptOptions) => {
          prompts.push(options)
          if (answers.length) return Promise.resolve(answers.shift())
          return new Promise((resolve) => { pending = resolve })
        },
        clear: () => { cleared++; pending?.(undefined) },
      },
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
      slot: () => () => {},
    },
  } as unknown as Plugin.Context)
  const location = { directory: "/project" }
  const request = { requestID: "req", sessionID: "ses", name: "API_TOKEN", reason: "Call the API" }
  return {
    calls, prompts, toasts, listeners, cleared: () => cleared,
    request: () => listeners.get("requested")!({ data: request, location }),
    resolve: () => listeners.get("resolved")!({ data: { requestID: "req" }, location }),
    cleanup: async () => { if (cleanup) await cleanup() },
  }
}

test("prompts until a value is entered, then submits it to the requesting location", async () => {
  const { calls, prompts, toasts, request, cleanup, listeners } = await harness(["", "x"])
  await request()
  expect(prompts).toEqual([
    { title: "Enter API_TOKEN", description: "Call the API", placeholder: "Secret value" },
    { title: "Enter API_TOKEN", description: "Call the API", placeholder: "Secret value" },
  ])
  expect(calls).toEqual([["submit", { requestID: "req", value: "x" }, { location: { directory: "/project" } }]])
  expect(toasts).toEqual([{ variant: "success", message: "Secret API_TOKEN stored." }])
  await cleanup()
  expect(listeners.size).toBe(0)
})

test("cancels when dismissed and closes dialogs answered elsewhere", async () => {
  const dismissed = await harness([undefined])
  await dismissed.request()
  expect(dismissed.calls).toEqual([["cancel", { requestID: "req" }, { location: { directory: "/project" } }]])

  const elsewhere = await harness([])
  const answering = elsewhere.request()
  await Bun.sleep(0)
  await elsewhere.resolve()
  await answering
  expect(elsewhere.cleared()).toBe(1)
  expect(elsewhere.calls).toEqual([])
  await elsewhere.resolve()
  expect(elsewhere.cleared()).toBe(1)
})

test("/secrets lists stored names and deletes the selected one with ctrl+d", async () => {
  let names = ["API_TOKEN", "NPM_TOKEN"]
  const calls: Array<[string, unknown, unknown]> = []
  const selects: DialogSelectOptions<string>[] = []
  const toasts: ToastOptions[] = []
  let cleared = 0
  let command: KeymapCommand | undefined
  let render!: SlotClaim<"app">["render"]
  const location = { directory: "/project" }
  const cleanup = await blindfold.setup({
    location: undefined,
    client: {
      rpc: () => ({
        list: async (input: unknown, options: unknown) => { calls.push(["list", input, options]); return { names } },
        remove: async (input: { name: string }, options: unknown) => {
          calls.push(["remove", input, options])
          const accepted = names.includes(input.name)
          names = names.filter((name) => name !== input.name)
          return { accepted }
        },
        events: { on: () => () => {} },
      }),
    },
    keymap: { layer: (get: () => KeymapLayer) => { command = get().commands?.[0] } },
    data: { session: { get: () => ({ location }), sync: async () => {} } },
    ui: {
      slot: (claim: SlotClaim<"app">) => { render = claim.render; return () => {} },
      router: { current: () => ({ type: "session", sessionID: "ses" }) },
      dialog: {
        select: (options: DialogSelectOptions<string>) => { selects.push(options); return new Promise(() => {}) },
        clear: () => { cleared++ },
      },
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
    },
  } as unknown as Plugin.Context)
  render({})
  if (!command) throw new Error("Secrets command was not registered")
  expect(command).toMatchObject({ id: "blindfold.secrets", palette: true, slash: { name: "secrets" } })

  void command.run()
  await Bun.sleep(0)
  expect(selects[0].options).toEqual([{ title: "API_TOKEN", value: "API_TOKEN" }, { title: "NPM_TOKEN", value: "NPM_TOKEN" }])
  const [remove] = selects[0].actions!
  expect(remove).toMatchObject({ bind: "ctrl+d", title: "delete" })
  if (remove.selection === "none") throw new Error("Delete must act on the selected secret")

  remove.onTrigger("API_TOKEN")
  await Bun.sleep(0)
  expect(calls).toContainEqual(["remove", { name: "API_TOKEN" }, { location }])
  expect(toasts).toEqual([{ variant: "success", message: "Secret API_TOKEN deleted." }])
  expect(selects[1].options).toEqual([{ title: "NPM_TOKEN", value: "NPM_TOKEN" }])
  expect(selects[1].current).toBe("NPM_TOKEN")

  const last = selects[1].actions![0]
  if (last.selection === "none") throw new Error("Delete must act on the selected secret")
  last.onTrigger("NPM_TOKEN")
  await Bun.sleep(0)
  expect(selects).toHaveLength(2)
  expect(cleared).toBe(1)
  expect(toasts.at(-1)).toEqual({ variant: "info", message: "No secrets stored." })
  expect(calls.filter(([method]) => method === "list").every(([, , options]) => JSON.stringify(options) === JSON.stringify({ location }))).toBe(true)
  await cleanup?.()
})

import { expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogPromptOptions, ToastOptions } from "@opencode/plugin/tui/context"
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

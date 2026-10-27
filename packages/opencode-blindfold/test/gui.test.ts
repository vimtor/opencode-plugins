import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin, PromptOptions, SetupContext, ToastOptions } from "@opencode/plugin/gui"
import { createRoot, createSignal, onCleanup } from "solid-js"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-blindfold/tui"))))
  const { gui } = Host.resolve({ directory })
  if (!gui) throw new Error("Missing GUI entrypoint")
  const provided: Record<string, unknown> = {
    "solid-js": await import("solid-js"),
    "@opencode/plugin/gui": await import("@opencode/plugin/gui"),
    "@opencode/plugin/rpc": await import("@opencode/plugin/rpc"),
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

type Listener = (event: { data: Record<string, unknown>; location: unknown }) => unknown

function client(accepted = true) {
  const listeners = new Map<string, Listener>()
  const calls: [string, unknown, unknown][] = []
  const call = (name: string) => async (input: unknown, options: unknown) => {
    calls.push([name, input, options])
    return { accepted: name === "ack" ? accepted : true }
  }
  const rpc = {
    ack: call("ack"),
    submit: call("submit"),
    cancel: call("cancel"),
    events: {
      on: (name: string, listener: Listener) => {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  }
  return { listeners, calls, rpc: () => rpc }
}

function mount(answers: (string | undefined)[], accepted?: boolean) {
  const [server, setServer] = createSignal(client(accepted))
  const prompts: PromptOptions[] = []
  const toasts: ToastOptions[] = []
  let closed = 0
  const ctx = {
    options: {},
    get client() {
      return server()
    },
    dialogs: {
      // Like the app's dialogs, a prompt closes with the owner that asked.
      prompt: (options: PromptOptions) => {
        prompts.push(options)
        if (answers.length) return Promise.resolve(answers.shift())
        return new Promise((resolve) =>
          onCleanup(() => {
            closed++
            resolve(undefined)
          }),
        )
      },
    },
    toast: { show: (toast: ToastOptions) => toasts.push(toast) },
  } as unknown as SetupContext<{}>
  const dispose = createRoot((dispose) => {
    setup(ctx)
    return dispose
  })
  const location = { directory: "/project" }
  const data = { requestID: "req", sessionID: "ses", name: "API_TOKEN", reason: "Call the API" }
  return {
    prompts,
    toasts,
    dispose,
    server,
    setServer,
    closed: () => closed,
    request: () => server().listeners.get("requested")!({ data, location }),
    resolve: () => server().listeners.get("resolved")!({ data: { requestID: "req" }, location }),
  }
}

const location = { location: { directory: "/project" } }

test("asks for the secret in a hidden prompt and submits it to the requesting location", async () => {
  const { prompts, toasts, server, request } = mount(["s3cret"])
  await request()
  expect(prompts).toEqual([
    { title: "Enter API_TOKEN", description: "Call the API", placeholder: "Secret value", secret: true },
  ])
  expect(server().calls).toEqual([
    ["ack", { requestID: "req" }, location],
    ["submit", { requestID: "req", value: "s3cret" }, location],
  ])
  expect(toasts).toEqual([{ variant: "success", title: "Secret API_TOKEN stored." }])
})

test("cancels the request when the prompt is dismissed", async () => {
  const { server, request } = mount([undefined])
  await request()
  expect(server().calls.map(([name]) => name)).toEqual(["ack", "cancel"])
})

test("leaves a request another window acknowledged first", async () => {
  const { prompts, server, request } = mount([], false)
  await request()
  expect(prompts).toEqual([])
  expect(server().calls.map(([name]) => name)).toEqual(["ack"])
})

test("closes the prompt when another client answers", async () => {
  const { server, request, resolve, closed } = mount([])
  const answering = request()
  await Bun.sleep(0)
  resolve()
  await answering
  expect(closed()).toBe(1)
  expect(server().calls.map(([name]) => name)).toEqual(["ack"])
})

test("listens again when the server restarts, and stops with the plugin", () => {
  const { server, setServer, dispose } = mount([])
  const stale = server()
  setServer(client())
  expect(stale.listeners.size).toBe(0)
  expect([...server().listeners.keys()]).toEqual(["requested", "resolved"])
  dispose()
  expect(server().listeners.size).toBe(0)
})

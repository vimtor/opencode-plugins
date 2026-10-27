import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Command, ConfirmOptions, Plugin, PromptOptions, SetupContext, ToastOptions } from "@opencode/plugin/gui"
import { createRoot, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"

// Evaluates the bundle as the desktop app does: CommonJS text with the app's own modules.
async function load() {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-agent-meetup/tui"))))
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

type Listener = (event: { data: Record<string, unknown> }) => unknown

const location = { directory: "/project" }
const session = (id: string, server = "sidecar") => ({ id, key: `${server}\n${id}`, server: { id: server }, location })

function mount(input: { prompt?: string; copy?: boolean; results?: Record<string, unknown> } = {}) {
  const toasts: ToastOptions[] = []
  const prompts: PromptOptions[] = []
  const confirms: ConfirmOptions[] = []
  const calls: [string, unknown, unknown][] = []
  const copied: string[] = []
  const listeners = new Map<string, Listener>()
  const items: (() => Command | undefined)[] = []
  const [current, setCurrent] = createSignal<ReturnType<typeof session> | undefined>(session("ses_a"))
  const method = (name: string) => async (args: unknown, options: unknown) => {
    calls.push([name, args, options])
    return input.results?.[name] ?? {}
  }
  const rpc = {
    status: method("status"),
    host: method("host"),
    join: method("join"),
    leave: method("leave"),
    events: {
      on: (name: string, listener: Listener) => {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  }
  const ctx = {
    options: {},
    client: { rpc: () => rpc },
    add: (_registry: unknown, item: () => Command | undefined) => items.push(item),
    sessions: { current },
    servers: { get: () => ({ data: { session: { get: () => ({ title: "Auth refactor" }) } } }) },
    storage: {
      memory: (_key: string, options: { initial: Record<string, string> }) => {
        const [state, setState] = createStore(options.initial)
        return [state, (mutation: (draft: Record<string, string>) => void) => setState(produce(mutation))]
      },
    },
    toast: { show: (toast: ToastOptions) => (toasts.push(toast), { dismiss: () => {} }) },
    dialogs: {
      prompt: async (options: PromptOptions) => (prompts.push(options), input.prompt),
      confirm: async (options: ConfirmOptions) => (confirms.push(options), input.copy ?? false),
    },
    system: { copy: async (text: string) => void copied.push(text) },
  } as unknown as SetupContext<{}>
  createRoot(() => setup(ctx))
  const enabled = () => items.map((item) => item()).filter((item) => item?.enabled).map((item) => item!.slash!.name)
  const run = async (slash: string) => {
    items.map((item) => item()).find((item) => item?.slash?.name === slash)!.run()
    await Bun.sleep(0)
  }
  return { toasts, prompts, confirms, calls, copied, listeners, enabled, run, setCurrent }
}

test("asks the server for the session's role and enables matching commands", async () => {
  const { calls, enabled } = mount({ results: { status: { role: "host" } } })
  await Bun.sleep(0)
  expect(calls).toEqual([["status", { sessionID: "ses_a" }, { location }]])
  expect(enabled()).toEqual(["meetup-end"])
})

test("hosts a meetup, copies the invite, then offers end", async () => {
  const invite = "https://abc.tunnel.opentunnel.xyz/#token"
  const { run, enabled, confirms, copied, toasts } = mount({ copy: true, results: { host: { invite, expires: "1 hour" } } })
  expect(enabled()).toEqual(["meetup-host", "meetup-join"])
  await run("meetup-host")
  expect(confirms[0]).toMatchObject({ title: "Meetup open", confirm: "Copy", cancel: "Close" })
  expect(confirms[0]!.description).toContain(invite)
  expect(confirms[0]!.description).toContain("Anyone with it can message this session for 1 hour.")
  expect(copied).toEqual([invite])
  expect(toasts).toEqual([{ variant: "success", title: "Meetup", description: "Invite copied." }])
  expect(enabled()).toEqual(["meetup-end"])
})

test("joins with the pasted invite, then offers leave", async () => {
  const { run, prompts, calls, toasts, enabled } = mount({ prompt: " https://x/#t ", results: { join: { peer: "alice" } } })
  await run("meetup-join")
  expect(prompts[0]!.title).toBe("Join a meetup")
  expect(calls.find((call) => call[0] === "join")).toEqual(["join", { sessionID: "ses_a", invite: "https://x/#t" }, { location }])
  expect(toasts.at(-1)).toEqual({ variant: "success", title: "Meetup", description: "Joined alice's meetup." })
  expect(enabled()).toEqual(["meetup-leave"])
})

test("reports errors and keeps host and join", async () => {
  const { run, toasts, enabled } = mount({ prompt: "https://x/#t", results: { join: { error: "Invalid meetup token" } } })
  await run("meetup-join")
  expect(toasts.at(-1)).toEqual({ variant: "error", title: "Meetup", description: "Invalid meetup token" })
  expect(enabled()).toEqual(["meetup-host", "meetup-join"])
})

test("server events update commands and show toasts", async () => {
  const { listeners, toasts, enabled } = mount()
  const changed = listeners.get("changed")!
  changed({ data: { sessionID: "ses_a", role: "host", kind: "joined", peer: "bob" } })
  expect(enabled()).toEqual(["meetup-end"])
  changed({ data: { sessionID: "ses_a", role: "none", kind: "ended", reason: "alice ended the meetup" } })
  expect(enabled()).toEqual(["meetup-host", "meetup-join"])
  expect(toasts.map((toast) => [toast.variant, toast.description])).toEqual([
    ["success", "bob joined the meetup in Auth refactor."],
    ["default", "alice ended the meetup in Auth refactor."],
  ])
})

test("disables every command outside a session of this app's server", () => {
  const { enabled, setCurrent } = mount()
  setCurrent(undefined)
  expect(enabled()).toEqual([])
  setCurrent(session("ses_b", "http://remote:4096"))
  expect(enabled()).toEqual([])
})

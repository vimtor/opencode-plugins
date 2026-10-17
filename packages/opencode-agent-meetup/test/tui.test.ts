import { expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogConfirmOptions, DialogPromptOptions, ToastOptions } from "@opencode/plugin/tui/context"
import meetup from "opencode-agent-meetup/tui"
import { createRoot } from "solid-js"

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-agent-meetup/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", meetup)
})

type Command = { id: string; slash?: { name: string }; run: (input?: string) => unknown }
type Listener = (event: { data: Record<string, unknown> }) => unknown

async function harness(input: { prompt?: string; copy?: boolean; results?: Record<string, unknown> } = {}) {
  const toasts: ToastOptions[] = []
  const prompts: DialogPromptOptions[] = []
  const confirms: DialogConfirmOptions[] = []
  const calls: Array<[string, unknown, unknown]> = []
  const copied: string[] = []
  const listeners = new Map<string, Listener>()
  let layer: (() => { commands: Command[] }) | undefined
  const location = { directory: "/project" }
  const method = (name: string) => async (args: unknown, options: unknown) => {
    calls.push([name, args, options])
    return input.results?.[name] ?? {}
  }
  await meetup.setup({
    client: {
      rpc: () => ({
        status: method("status"),
        host: method("host"),
        join: method("join"),
        leave: method("leave"),
        events: { on: (name: string, listener: Listener) => { listeners.set(name, listener); return () => listeners.delete(name) } },
      }),
    },
    renderer: { copyToClipboardOSC52: (text: string) => copied.push(text) > 0 },
    data: { session: { get: () => ({ location, title: "Auth refactor" }), sync: async () => {} } },
    storage: {
      memory: (_key: string, options: { initial: object }) => {
        const state = options.initial
        return [state, (mutation: (draft: object) => void) => mutation(state)]
      },
    },
    keymap: { layer: (factory: typeof layer) => { layer = factory } },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "ses_a" }) },
      slot: (claim: { render: () => unknown }) => createRoot((dispose) => { claim.render(); return dispose }),
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
      dialog: {
        prompt: async (options: DialogPromptOptions) => { prompts.push(options); return input.prompt },
        confirm: async (options: DialogConfirmOptions) => { confirms.push(options); return input.copy },
      },
    },
  } as unknown as Plugin.Context)
  const commands = () => layer!().commands
  const slashes = () => commands().map((command) => command.slash?.name)
  const run = async (slash: string) => {
    await commands().find((command) => command.slash?.name === slash)!.run()
    await Bun.sleep(0)
  }
  return { toasts, prompts, confirms, calls, copied, listeners, location, slashes, run }
}

test("asks the server for the session's role and shows matching commands", async () => {
  const { calls, slashes, location } = await harness({ results: { status: { role: "host" } } })
  await Bun.sleep(0)
  expect(calls[0]).toEqual(["status", { sessionID: "ses_a" }, { location }])
  expect(slashes()).toEqual(["meetup-end"])
})

test("offers host and join outside a meetup, then end once hosting", async () => {
  const invite = "https://abc.tunnel.opentunnel.xyz/#token"
  const { run, slashes, confirms, copied, toasts } = await harness({ copy: true, results: { status: { role: "none" }, host: { invite, expires: "1 hour" } } })
  await Bun.sleep(0)
  expect(slashes()).toEqual(["meetup-host", "meetup-join"])
  await run("meetup-host")
  expect(confirms[0]).toMatchObject({ title: "Meetup open", label: { confirm: "Copy", cancel: "Close" } })
  expect(confirms[0]!.message).toContain(invite)
  expect(confirms[0]!.message).toContain("Anyone with it can message this session for 1 hour.")
  expect(copied).toEqual([invite])
  expect(toasts.map((toast) => toast.message)).toEqual(["Invite copied."])
  expect(slashes()).toEqual(["meetup-end"])
})

test("closing the invite dialog doesn't copy", async () => {
  const { run, copied, toasts } = await harness({ copy: false, results: { host: { invite: "https://x/#t" } } })
  await run("meetup-host")
  expect(copied).toEqual([])
  expect(toasts).toEqual([])
})

test("join asks for the invite and switches to leave", async () => {
  const { run, prompts, calls, toasts, slashes } = await harness({ prompt: " https://x/#t ", results: { join: { peer: "alice" } } })
  await run("meetup-join")
  expect(prompts[0]!.title).toBe("Join a meetup")
  expect(calls.find((call) => call[0] === "join")?.[1]).toEqual({ sessionID: "ses_a", invite: "https://x/#t" })
  expect(toasts.at(-1)).toMatchObject({ variant: "success", message: "Joined alice's meetup." })
  expect(slashes()).toEqual(["meetup-leave"])
})

test("join reports errors and keeps host and join", async () => {
  const { run, toasts, slashes } = await harness({ prompt: "https://x/#t", results: { join: { error: "Invalid meetup token" } } })
  await run("meetup-join")
  expect(toasts.at(-1)).toMatchObject({ variant: "error", message: "Invalid meetup token" })
  expect(slashes()).toEqual(["meetup-host", "meetup-join"])
})

test("events update commands and show toasts", async () => {
  const { listeners, toasts, slashes } = await harness()
  const changed = listeners.get("changed")!
  await changed({ data: { sessionID: "ses_a", role: "host", kind: "opened" } })
  await changed({ data: { sessionID: "ses_a", role: "host", kind: "joined", peer: "bob" } })
  expect(slashes()).toEqual(["meetup-end"])
  await changed({ data: { sessionID: "ses_a", role: "none", kind: "ended", reason: "alice ended the meetup" } })
  expect(slashes()).toEqual(["meetup-host", "meetup-join"])
  expect(toasts.map((toast) => toast.message)).toEqual([
    "bob joined the meetup in Auth refactor.",
    "alice ended the meetup in Auth refactor.",
  ])
})

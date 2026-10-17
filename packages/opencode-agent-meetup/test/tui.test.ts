import { expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogPromptOptions, ToastOptions } from "@opencode/plugin/tui/context"
import meetup from "opencode-agent-meetup/tui"

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-agent-meetup/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", meetup)
})

type Command = { id: string; slash?: { name: string }; run: (input?: string) => unknown }
type Listener = (event: { data: Record<string, unknown> }) => unknown

async function harness(input: { prompt?: string; results?: Record<string, unknown> } = {}) {
  const toasts: ToastOptions[] = []
  const prompts: DialogPromptOptions[] = []
  const alerts: Array<{ title: string; message: string }> = []
  const calls: Array<[string, unknown, unknown]> = []
  const copied: string[] = []
  const listeners = new Map<string, Listener>()
  let commands: Command[] = []
  const location = { directory: "/project" }
  const method = (name: string) => async (args: unknown, options: unknown) => {
    calls.push([name, args, options])
    return input.results?.[name] ?? {}
  }
  await meetup.setup({
    client: {
      rpc: () => ({
        host: method("host"),
        join: method("join"),
        leave: method("leave"),
        events: { on: (name: string, listener: Listener) => { listeners.set(name, listener); return () => listeners.delete(name) } },
      }),
    },
    renderer: { copyToClipboardOSC52: (text: string) => copied.push(text) > 0 },
    data: { session: { get: () => ({ location, title: "Auth refactor" }), sync: async () => {} } },
    keymap: { layer: (factory: () => { commands: Command[] }) => { commands = factory().commands } },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "ses_a" }) },
      slot: (claim: { render: () => unknown }) => { claim.render(); return () => {} },
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
      dialog: {
        prompt: async (options: DialogPromptOptions) => { prompts.push(options); return input.prompt },
        alert: async (options: { title: string; message: string }) => { alerts.push(options) },
      },
    },
  } as unknown as Plugin.Context)
  const run = (slash: string, argument?: string) => commands.find((command) => command.slash?.name === slash)!.run(argument)
  return { toasts, prompts, alerts, calls, copied, listeners, commands, location, run }
}

test("registers host, join, and leave slash commands", async () => {
  const { commands } = await harness()
  expect(commands.map((command) => command.slash?.name)).toEqual(["meetup-host", "meetup-join", "meetup-leave"])
})

test("host copies the invite and shows it", async () => {
  const invite = "https://abc.tunnel.opentunnel.xyz/#token"
  const { run, calls, copied, alerts, toasts, location } = await harness({ results: { host: { invite } } })
  await run("meetup-host")
  expect(calls).toEqual([["host", { sessionID: "ses_a" }, { location }]])
  expect(copied).toEqual([invite])
  expect(toasts.map((toast) => toast.message)).toEqual([
    "Opening a tunnel. The first time can take a minute.",
    "Meetup open. Invite copied to the clipboard.",
  ])
  expect(alerts[0]!.message).toContain(invite)
})

test("join asks for the invite when none is given", async () => {
  const { run, prompts, calls, toasts } = await harness({ prompt: " https://x/#t ", results: { join: { peer: "alice" } } })
  await run("meetup-join")
  expect(prompts[0]!.title).toBe("Join a meetup")
  expect(calls[0]).toMatchObject(["join", { sessionID: "ses_a", invite: "https://x/#t" }])
  expect(toasts.at(-1)).toMatchObject({ variant: "success", message: "Joined alice's meetup." })
})

test("join uses an inline invite and reports errors", async () => {
  const { run, prompts, toasts } = await harness({ results: { join: { error: "Invalid meetup token" } } })
  await run("meetup-join", "https://x/#t")
  expect(prompts).toEqual([])
  expect(toasts.at(-1)).toMatchObject({ variant: "error", message: "Invalid meetup token" })
})

test("shows toasts for meetup events", async () => {
  const { listeners, toasts } = await harness()
  const changed = listeners.get("changed")!
  await changed({ data: { sessionID: "ses_a", kind: "joined", peer: "bob" } })
  await changed({ data: { sessionID: "ses_a", kind: "ended", reason: "alice ended the meetup" } })
  expect(toasts.map((toast) => toast.message)).toEqual([
    "bob joined the meetup in Auth refactor.",
    "alice ended the meetup in Auth refactor.",
  ])
})

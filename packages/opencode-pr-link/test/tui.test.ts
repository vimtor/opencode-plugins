import { afterEach, beforeAll, expect, mock, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand, KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"

const opened: string[] = []
mock.module("open", () => ({ default: async (url: string) => { opened.push(url) } }))

let prLink: typeof import("opencode-pr-link/tui").default
beforeAll(async () => {
  prLink = (await import("opencode-pr-link/tui")).default
})

const PATH = process.env.PATH
afterEach(() => {
  process.env.PATH = PATH
  opened.length = 0
})

function fakeGh(script: string) {
  const bin = mkdtempSync(join(tmpdir(), "opencode-pr-link-bin-"))
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, "gh"), 0o755)
  process.env.PATH = `${bin}:${PATH}`
  return bin
}

async function setup(input: {
  options?: Record<string, unknown>
  route?: { type: "home" } | { type: "session"; sessionID: string }
  sessions?: Record<string, string>
  location?: string
}) {
  let command: KeymapCommand | undefined
  let render!: SlotClaim<"app">["render"]
  let disposed = false
  const toasts: ToastOptions[] = []
  const synced: string[] = []
  const cleanup = await prLink.setup({
    options: input.options ?? {},
    location: undefined,
    keymap: { layer: (get: () => KeymapLayer) => { command = get().commands?.[0] } },
    data: {
      session: {
        get: (sessionID: string) => synced.includes(sessionID) && input.sessions?.[sessionID]
          ? { id: sessionID, location: { directory: input.sessions[sessionID] } }
          : undefined,
        sync: async (sessionID: string) => { synced.push(sessionID) },
      },
      location: { default: () => ({ directory: input.location ?? "/" }) },
    },
    ui: {
      slot: (claim: SlotClaim<"app">) => {
        expect(claim.append).toBe("app")
        render = claim.render
        return () => { disposed = true }
      },
      router: { current: () => input.route ?? { type: "home" } },
      toast: { show: (toast: ToastOptions) => { toasts.push(toast) } },
    },
  } as unknown as Plugin.Context)
  render({})
  if (!command) throw new Error("PR Link command was not registered")
  return { command, toasts, cleanup: async () => { if (cleanup) await cleanup(); return disposed } }
}

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-pr-link/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", prLink)
})

test.each([
  { label: "no shortcut by default", options: {}, bind: false },
  { label: "configured shortcut", options: { keybind: "ctrl+shift+p" }, bind: "ctrl+shift+p" },
  { label: "disabled shortcut", options: { keybind: false }, bind: false },
  { label: "none shortcut", options: { keybind: "none" }, bind: false },
])("registers the command with $label", async ({ options, bind }) => {
  const { command, cleanup } = await setup({ options })
  expect(command.id).toBe("pr-link.open")
  expect(command.bind).toBe(bind)
  expect(command.palette).toBe(true)
  expect(command.slash?.name).toBe("pr")
  expect(await cleanup()).toBe(true)
})

test("opens the pull request for the session directory", async () => {
  const session = realpathSync(mkdtempSync(join(tmpdir(), "opencode-pr-link-session-")))
  const log = join(session, "gh.log")
  fakeGh(`pwd > "${log}"\necho "$@" >> "${log}"\necho https://github.com/vimtor/opencode-plugins/pull/42`)
  const { command, toasts } = await setup({
    route: { type: "session", sessionID: "session" },
    sessions: { session },
    location: "/",
  })
  await command.run()
  expect(toasts).toEqual([])
  expect(opened).toEqual(["https://github.com/vimtor/opencode-plugins/pull/42"])
  expect(readFileSync(log, "utf8")).toBe(`${session}\npr view --json url --jq .url\n`)
})

test("falls back to the default directory outside sessions", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "opencode-pr-link-home-")))
  const log = join(directory, "gh.log")
  fakeGh(`pwd > "${log}"\necho https://github.com/vimtor/opencode-plugins/pull/7`)
  const { command } = await setup({ location: directory })
  await command.run()
  expect(opened).toEqual(["https://github.com/vimtor/opencode-plugins/pull/7"])
  expect(readFileSync(log, "utf8")).toBe(`${directory}\n`)
})

test("shows gh errors without opening the browser", async () => {
  fakeGh(`echo 'no pull requests found for branch "main"' >&2\nexit 1`)
  const { command, toasts } = await setup({ location: tmpdir() })
  await command.run()
  expect(opened).toEqual([])
  expect(toasts).toEqual([{ variant: "warning", message: 'no pull requests found for branch "main"' }])
})

test("asks to install gh when it is missing", async () => {
  process.env.PATH = mkdtempSync(join(tmpdir(), "opencode-pr-link-empty-"))
  const { command, toasts } = await setup({ location: tmpdir() })
  await command.run()
  expect(opened).toEqual([])
  expect(toasts).toEqual([{ variant: "warning", message: "Install the GitHub CLI (gh) to open pull requests." }])
})

test.each([true, 42, "", "   "])("rejects invalid keybind option %p", (keybind) => {
  expect(() => prLink.setup({ options: { keybind } } as unknown as Plugin.Context)).toThrow(
    "opencode-pr-link keybind option must be a non-empty string or false",
  )
})

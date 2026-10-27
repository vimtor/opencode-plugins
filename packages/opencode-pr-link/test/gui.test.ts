import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import type { Command, Plugin, SetupContext, ToastOptions } from "@opencode/plugin/gui"
import type { MainContext } from "@opencode/plugin/gui/main"
import { createRoot } from "solid-js"

// A stand-in for the other process's modules, as the desktop app provides.
const inert: unknown = new Proxy(function () {}, { get: () => inert, apply: () => inert, construct: () => inert as object })

// Evaluates the bundle as the desktop app does: CommonJS text with the process's own modules.
async function load(target: "window" | "main") {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-pr-link/tui"))))
  const { gui } = Host.resolve({ directory })
  if (!gui) throw new Error("Missing GUI entrypoint")
  const provided: Record<string, unknown> = {
    effect: await import("effect"),
    "solid-js": await import("solid-js"),
    "@opencode/plugin/gui": await import("@opencode/plugin/gui"),
  }
  const builtin = createRequire(import.meta.url)
  const module = { exports: {} as { default?: Plugin.Definition } }
  const require = (id: string) => {
    if (id in provided) return provided[id]
    if (id.startsWith("node:")) return target === "main" ? builtin(id) : inert
    throw new Error(`The app does not provide ${id}`)
  }
  new Function("module", "exports", "require", readFileSync(fileURLToPath(gui), "utf8"))(module, module.exports, require)
  return module.exports.default!
}

const window = await load("window")
const main = await load("main")

const PATH = process.env.PATH
afterEach(() => {
  process.env.PATH = PATH
})

function fakeGh(script: string) {
  const bin = mkdtempSync(join(tmpdir(), "opencode-pr-link-bin-"))
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, "gh"), 0o755)
  process.env.PATH = `${bin}:${PATH}`
}

async function mount(input: { directory?: string; options?: Record<string, unknown> } = {}) {
  const provided = new Map<string, Record<string, (value: unknown) => unknown>>()
  await main.main!({
    provide: (token: { id: string }, impl: Record<string, (value: unknown) => unknown>) => provided.set(token.id, impl),
  } as unknown as MainContext)
  const commands: Command[] = []
  const toasts: ToastOptions[] = []
  const opened: string[] = []
  const ctx = {
    options: input.options ?? {},
    add: (_registry: unknown, item: Command) => commands.push(item),
    main: (token: { id: string }) =>
      new Proxy({}, { get: (_target, method: string) => async (value: unknown) => provided.get(token.id)![method]!(value) }),
    sessions: { current: () => (input.directory ? { directory: input.directory } : undefined) },
    toast: { show: (toast: ToastOptions) => toasts.push(toast) },
    system: { openExternal: (url: string) => opened.push(url) },
  } as unknown as SetupContext<{}>
  createRoot(() => window.setup!(ctx))
  const command = commands[0]!
  return { command, toasts, opened, run: async () => void (await command.run()) }
}

test("adds an Open pull request command", async () => {
  const { command } = await mount()
  expect(command).toMatchObject({ id: "open", title: "Open pull request", bind: undefined })
  expect((await mount({ options: { keybind: "ctrl+shift+p" } })).command.bind).toBe("ctrl+shift+p")
  expect((await mount({ options: { keybind: "none" } })).command.bind).toBeUndefined()
  await expect(mount({ options: { keybind: "" } })).rejects.toThrow("opencode-pr-link keybind option must be a non-empty string or false")
})

test("opens the pull request of the session's directory", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "opencode-pr-link-session-")))
  const log = join(directory, "gh.log")
  fakeGh(`pwd > "${log}"\necho "$@" >> "${log}"\necho https://github.com/vimtor/opencode-plugins/pull/42`)
  const { run, opened, toasts } = await mount({ directory })
  await run()
  expect(toasts).toEqual([])
  expect(opened).toEqual(["https://github.com/vimtor/opencode-plugins/pull/42"])
  expect(readFileSync(log, "utf8")).toBe(`${directory}\npr view --json url --jq .url\n`)
})

test("explains a branch without a pull request", async () => {
  fakeGh(`echo 'no pull requests found for branch "feat/x"' >&2\nexit 1`)
  const { run, opened, toasts } = await mount({ directory: realpathSync(tmpdir()) })
  await run()
  expect(opened).toEqual([])
  expect(toasts).toEqual([{ variant: "default", title: "No pull request", description: "Branch feat/x has no pull request." }])
})

test("reports gh failures as errors", async () => {
  fakeGh(`echo 'To get started with GitHub CLI, please run:  gh auth login' >&2\nexit 1`)
  const { run, toasts } = await mount({ directory: realpathSync(tmpdir()) })
  await run()
  expect(toasts).toEqual([
    { variant: "error", title: "GitHub CLI not signed in", description: "Run gh auth login to open pull requests." },
  ])
})

test("asks for a session outside one", async () => {
  const { run, opened, toasts } = await mount()
  await run()
  expect(opened).toEqual([])
  expect(toasts).toEqual([{ title: "Open a session first." }])
})

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { Plugin } from "@opencode/plugin/tui"
import type { ToastOptions } from "@opencode/plugin/tui/context"
import open from "open"

type ExecError = Error & { code?: string | number; stderr?: string }

function findPullRequest(directory: string) {
  return new Promise<string>((resolve, reject) => {
    execFile("gh", ["pr", "view", "--json", "url", "--jq", ".url"], { cwd: directory, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stderr }))
      resolve(stdout.trim())
    })
  })
}

function errorToast(error: ExecError, directory: string): ToastOptions {
  if (error.code === "ENOENT") {
    return { variant: "error", title: "GitHub CLI not found", message: "Install gh to open pull requests." }
  }
  const stderr = error.stderr ?? ""
  const branch = stderr.match(/no pull requests found for branch "(.+)"/)?.[1]
  if (branch) return { variant: "warning", title: "No pull request", message: `Branch ${branch} has no pull request.` }
  if (/not a git repository/i.test(stderr)) {
    return { variant: "warning", title: "Not a Git repository", message: directory }
  }
  if (/not on any branch/i.test(stderr)) {
    return { variant: "warning", title: "No branch checked out", message: "Check out a branch to open its pull request." }
  }
  if (stderr.includes("gh auth login")) {
    return { variant: "error", title: "GitHub CLI not signed in", message: "Run gh auth login to open pull requests." }
  }
  const line = stderr.split("\n").map((line) => line.trim()).find(Boolean)
  return { variant: "error", title: "Could not open pull request", message: line || error.message }
}

export default Plugin.define({
  id: "opencode-pr-link",
  setup(ctx) {
    const keybind = ctx.options.keybind ?? false
    if (keybind !== false && (typeof keybind !== "string" || keybind.trim() === "")) {
      throw new Error("opencode-pr-link keybind option must be a non-empty string or false")
    }

    async function directory() {
      const route = ctx.ui.router.current()
      if (route.type === "session") {
        if (!ctx.data.session.get(route.sessionID)) await ctx.data.session.sync(route.sessionID)
        const session = ctx.data.session.get(route.sessionID)
        if (session) return session.location.directory
      }
      return ctx.location?.directory ?? ctx.data.location.default().directory
    }

    async function openPullRequest() {
      const cwd = await directory()
      if (!existsSync(cwd)) {
        ctx.ui.toast.show({ variant: "warning", title: "Directory not found", message: ctx.ui.format.path(cwd) })
        return
      }
      let url: string
      try {
        url = await findPullRequest(cwd)
      } catch (error) {
        ctx.ui.toast.show(errorToast(error as ExecError, ctx.ui.format.path(cwd)))
        return
      }
      if (!url) {
        ctx.ui.toast.show({ variant: "error", title: "Could not open pull request", message: "GitHub CLI returned no URL." })
        return
      }
      await open(url).catch(() => {
        ctx.ui.toast.show({ variant: "error", title: "Could not open browser", message: url })
      })
    }

    return ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "pr-link.open",
              bind: keybind === "none" ? false : keybind,
              title: "Open pull request",
              group: "Plugin",
              palette: true,
              run: () => openPullRequest().catch(() => {
                ctx.ui.toast.show({ variant: "error", title: "Could not open pull request", message: "Something went wrong. Try again." })
              }),
            },
          ],
        }))
        return null
      },
    })
  },
})

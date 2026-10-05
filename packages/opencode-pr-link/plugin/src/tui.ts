import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"
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

function errorMessage(error: ExecError) {
  if (error.code === "ENOENT") return "Install the GitHub CLI (gh) to open pull requests."
  const line = error.stderr?.split("\n").map((line) => line.trim()).find(Boolean)
  return line?.replace(/^failed to run git: (fatal: )?/, "") || "Could not find a pull request."
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
      let url: string
      try {
        url = await findPullRequest(await directory())
      } catch (error) {
        ctx.ui.toast.show({ variant: "warning", message: errorMessage(error as ExecError) })
        return
      }
      if (!url) {
        ctx.ui.toast.show({ variant: "warning", message: "Could not find a pull request." })
        return
      }
      await open(url).catch(() => {
        ctx.ui.toast.show({ variant: "warning", title: "Could not open browser", message: url })
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
              slash: { name: "pr" },
              run: () => openPullRequest().catch(() => {
                ctx.ui.toast.show({ variant: "error", message: "Could not open pull request." })
              }),
            },
          ],
        }))
        return null
      },
    })
  },
})

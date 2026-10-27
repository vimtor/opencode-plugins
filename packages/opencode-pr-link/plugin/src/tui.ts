import { Plugin } from "@opencode/plugin/tui"
import open from "open"
import { lookup } from "./gh.js"

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
      const result = await lookup(await directory(), ctx.ui.format.path)
      if ("problem" in result) {
        ctx.ui.toast.show(result.problem)
        return
      }
      await open(result.url).catch(() => {
        ctx.ui.toast.show({ variant: "error", title: "Could not open browser", message: result.url })
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

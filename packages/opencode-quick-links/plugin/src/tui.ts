import { Plugin } from "@opencode/plugin/tui"
import open from "open"
import { extractLinks } from "./links.js"

export default Plugin.define({
  id: "opencode-quick-links",
  setup(ctx) {
    const keybind = ctx.options.keybind ?? false
    if (keybind !== false && (typeof keybind !== "string" || keybind.trim() === "")) {
      throw new Error("opencode-quick-links keybind option must be a non-empty string or false")
    }

    async function showQuickLinks() {
      const route = ctx.ui.router.current()
      if (route.type !== "session") {
        ctx.ui.toast.show({ variant: "warning", message: "Start a session." })
        return
      }

      await ctx.data.session.message.sync(route.sessionID)
      const links = extractLinks(ctx.data.session.message.list(route.sessionID))
      if (links.length === 0) {
        ctx.ui.toast.show({ variant: "info", message: "No links found in this session." })
        return
      }

      const url = await ctx.ui.dialog.select({
        title: "Quick Links",
        placeholder: "Search links in the conversation",
        options: links.map((link) => ({ title: link.url.replace(/^https?:\/\//, ""), value: link.url })),
      })
      if (!url) return
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
              id: "quick-links.open",
              bind: keybind === "none" ? false : keybind,
              title: "Open session links",
              group: "Plugin",
              palette: true,
              slash: { name: "links" },
              run: () => showQuickLinks().catch(() => {
                ctx.ui.toast.show({ variant: "error", message: "Could not load session links." })
              }),
            },
          ],
        }))
        return null
      },
    })
  },
})

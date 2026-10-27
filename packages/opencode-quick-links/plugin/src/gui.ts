import { Command, Plugin } from "@opencode/plugin/gui"
import { extractLinks } from "./links.js"

export default Plugin.define({
  setup(ctx) {
    const keybind = ctx.options.keybind ?? false
    if (keybind !== false && (typeof keybind !== "string" || keybind.trim() === "")) {
      throw new Error("opencode-quick-links keybind option must be a non-empty string or false")
    }

    async function showQuickLinks() {
      const session = ctx.sessions.current()
      if (!session) {
        ctx.toast.show({ title: "Start a session." })
        return
      }

      const data = session.server.data
      await data.session.message.sync(session.id)
      const links = extractLinks(data.session.message.list(session.id))
      if (links.length === 0) {
        ctx.toast.show({ title: "No links found in this session." })
        return
      }

      const url = await ctx.dialogs.select({
        title: "Quick Links",
        placeholder: "Search links in the conversation",
        options: links.map((link) => ({ title: link.url.replace(/^https?:\/\//, ""), value: link.url })),
      })
      if (url) ctx.system.openExternal(url)
    }

    ctx.add(Command, {
      id: "open",
      title: "Open session links",
      keywords: "links urls",
      bind: typeof keybind === "string" && keybind !== "none" ? keybind : undefined,
      slash: { name: "links" },
      run: () =>
        showQuickLinks().catch(() => {
          ctx.toast.show({ variant: "error", title: "Could not load session links." })
        }),
    })
  },
})

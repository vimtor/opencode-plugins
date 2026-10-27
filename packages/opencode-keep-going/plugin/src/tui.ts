import { Plugin } from "@opencode/plugin/tui"
import { getHidden, getMessage, type KeepGoingOptions } from "./options.js"

export default Plugin.define({
  id: "keep-going",
  setup(ctx) {
    const keepGoingOptions = ctx.options as KeepGoingOptions
    const hidden = getHidden(keepGoingOptions)
    const message = getMessage(keepGoingOptions)
    let sending = false

    async function send(sessionID: string) {
      sending = true
      try {
        const input = { sessionID, text: message, metadata: { source: "opencode-keep-going" }, resume: true }
        if (hidden) await ctx.client.session.synthetic(input)
        else await ctx.client.session.prompt(input)
      } catch {
        ctx.ui.toast.show({ variant: "error", message: "Could not continue the session." })
      } finally {
        sending = false
      }
    }

    return ctx.ui.slot({
      append: "prompt.footer",
      render(prompt) {
        ctx.keymap.layer(() => ({
          priority: 1000,
          enabled: () => prompt.mode === "normal" && !!prompt.sessionID,
          commands: [
            {
              id: "keep-going.send",
              title: "Keep Going",
              bind: "return",
              run: () => {
                const input = ctx.renderer.currentFocusedEditor?.plainText
                if (input === undefined || input.trim() !== "") return false

                const route = ctx.ui.router.current()
                if (route.type !== "session" || route.sessionID !== prompt.sessionID) return false
                if (sending) return

                return send(route.sessionID)
              },
            },
          ],
        }))
        return null
      },
    })
  },
})

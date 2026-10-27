import { Command, Plugin, type MountedSession } from "@opencode/plugin/gui"
import { getHidden, getMessage, type KeepGoingOptions } from "./options.js"

export default Plugin.define({
  setup(ctx) {
    const keepGoingOptions = ctx.options as KeepGoingOptions
    const hidden = getHidden(keepGoingOptions)
    const message = getMessage(keepGoingOptions)
    let sending = false

    async function send(session: MountedSession) {
      sending = true
      try {
        const input = { sessionID: session.id, text: message, metadata: { source: "opencode-keep-going" }, resume: true }
        if (hidden) await session.server.client.session.synthetic(input)
        else await session.server.client.session.prompt(input)
      } catch {
        ctx.toast.show({ variant: "error", title: "Could not continue the session." })
      } finally {
        sending = false
      }
    }

    ctx.add(Command, {
      id: "send",
      title: "Keep going",
      bind: "enter",
      editable: true,
      hidden: true,
      run: () => {
        const composer = ctx.screen.current()?.composer
        const session = ctx.sessions.current()
        // Returning false hands Enter back to the prompt. quotable() is false in shell mode and in subagent sessions.
        if (!composer?.focused() || !composer.quotable() || composer.text().trim() !== "" || !session) return false
        if (sending) return
        void send(session)
      },
    })
  },
})

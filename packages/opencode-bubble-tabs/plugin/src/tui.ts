import { Plugin } from "@opencode/plugin/tui"
import { listen, parseOn, parseReopen } from "./bubble.js"

export default Plugin.define({
  id: "opencode-bubble-tabs",
  setup(ctx) {
    const on = parseOn(ctx.options.on)
    const reopen = parseReopen(ctx.options.reopen)
    // Only sessions that had a tab here reopen, so sessions of other clients and directories stay out of the strip.
    // The TUI reports no tab changes, so tabs are noted at startup, on every prompt and on every bubble.
    const seen = new Set<string>()
    const note = () => {
      for (const tab of ctx.ui.tabs.list()) seen.add(tab.sessionID)
    }
    const timers = new Set<ReturnType<typeof setTimeout>>()
    // An opened tab joins the list once the TUI has saved it, so retry the move until then.
    const front = (sessionID: string, deadline: number) => {
      if (ctx.ui.tabs.move(sessionID, 0) || Date.now() > deadline) return
      const timer = setTimeout(() => {
        timers.delete(timer)
        front(sessionID, deadline)
      }, 20)
      timers.add(timer)
    }
    note()
    const stopNote = ctx.data.on("session.inbox.enqueued", note)
    const stop = listen(ctx.data, on, (sessionID) => {
      if (!ctx.ui.tabs.enabled()) return
      note()
      if (ctx.ui.tabs.list().some((tab) => tab.sessionID === sessionID)) return void ctx.ui.tabs.move(sessionID, 0)
      if (!reopen || !seen.has(sessionID) || !ctx.ui.tabs.open(sessionID)) return
      front(sessionID, Date.now() + 2000)
    })
    return () => {
      stopNote()
      stop()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  },
})

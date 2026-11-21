import { createKeyed, Plugin } from "@opencode/plugin/gui"
import { createEffect, onCleanup } from "solid-js"
import { type Events, listen, parseOn, parseReopen } from "./bubble.js"

// The desktop app's own server, which runs this plugin.
const SERVER = "sidecar"

export default Plugin.define({
  setup(ctx) {
    const on = parseOn(ctx.options.on)
    const reopen = parseReopen(ctx.options.reopen)
    const find = (sessionID: string) =>
      ctx.tabs.list().find((tab) => tab.session?.server.id === SERVER && tab.session.id === sessionID)
    // Only sessions that had a tab here reopen, so sessions of other clients stay out of the strip.
    const seen = new Set<string>()
    createEffect(() => {
      for (const tab of ctx.tabs.list()) if (tab.session?.server.id === SERVER) seen.add(tab.session.id)
    })
    // A restarted server comes back with new data, so listen again on each.
    createKeyed(
      (): Events | undefined => ctx.servers.get(SERVER)?.data,
      (data) =>
        onCleanup(
          listen(data, on, (sessionID) => {
            if (!find(sessionID) && reopen && seen.has(sessionID)) ctx.tabs.open({ server: SERVER, id: sessionID })
            const tab = find(sessionID)
            if (tab) ctx.tabs.move(tab.key, 0)
          }),
        ),
    )
  },
})

import { createKeyed, Plugin } from "@opencode/plugin/gui"
import { onCleanup } from "solid-js"
import { type Events, listen, parseOn } from "./bubble.js"

// The desktop app's own server, which runs this plugin.
const SERVER = "sidecar"

export default Plugin.define({
  setup(ctx) {
    const on = parseOn(ctx.options.on)
    // A restarted server comes back with new data, so listen again on each.
    createKeyed(
      (): Events | undefined => ctx.servers.get(SERVER)?.data,
      (data) =>
        onCleanup(
          listen(data, on, (sessionID) => {
            const tab = ctx.tabs.list().find((tab) => tab.session?.server.id === SERVER && tab.session.id === sessionID)
            if (tab) ctx.tabs.move(tab.key, 0)
          }),
        ),
    )
  },
})

import { createKeyed, Plugin } from "@opencode/plugin/gui"
import type { Plugin as Tui } from "@opencode/plugin/tui"
import { onCleanup } from "solid-js"
import { tab } from "./tab.js"

// The desktop app's own server, which runs this plugin.
const SERVER = "sidecar"

type Data = Pick<Tui.Context["data"], "on"> & { readonly session: { creating(sessionID: string): boolean } }

export default Plugin.define({
  setup(ctx) {
    const open = (id: string) => ctx.tabs.open({ server: SERVER, id })
    // A restarted server comes back with new data, so listen again on each.
    createKeyed(
      (): Data | undefined => ctx.servers.get(SERVER)?.data,
      (data) => {
        onCleanup(
          data.on("session.created", (event) => {
            if (event.data.parentID || tab(event.data.metadata) === false) return
            // A session this window creates already has its own tab.
            if (data.session.creating(event.data.sessionID)) return
            open(event.data.sessionID)
          }),
        )
        onCleanup(
          data.on("session.metadata.updated", (event) => {
            if (tab(event.data.metadata) === true) open(event.data.sessionID)
          }),
        )
      },
    )
  },
})

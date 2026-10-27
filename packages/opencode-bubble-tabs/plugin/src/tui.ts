import { Plugin } from "@opencode/plugin/tui"
import { listen, parseOn } from "./bubble.js"

export default Plugin.define({
  id: "opencode-bubble-tabs",
  setup(ctx) {
    return listen(ctx.data, parseOn(ctx.options.on), (sessionID) => {
      if (!ctx.ui.tabs.enabled()) return
      if (!ctx.ui.tabs.list().some((tab) => tab.sessionID === sessionID)) return
      ctx.ui.tabs.move(sessionID, 0)
    })
  },
})

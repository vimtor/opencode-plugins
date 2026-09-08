import { Plugin } from "@opencode/plugin/tui"
import open from "open"

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING_PUNCTUATION = /[\],.;:!?}]+$/

type QuickLink = {
  url: string
}

function trimTrailingParentheses(url: string) {
  let result = url

  while (result.endsWith(")")) {
    const opening = (result.match(/\(/g) ?? []).length
    const closing = (result.match(/\)/g) ?? []).length
    if (closing <= opening) break
    result = result.slice(0, -1)
  }

  return result
}

function extractLinks(messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>) {
  const seen = new Set<string>()
  const links: QuickLink[] = []

  for (const message of messages) {
    const texts = message.type === "user"
      ? [message.text]
      : message.type === "assistant"
        ? message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
        : []

    for (const text of texts) {
      for (const match of text.matchAll(URL_PATTERN)) {
        const candidate = trimTrailingParentheses(match[0].replace(TRAILING_PUNCTUATION, ""))
        let url: string

        try {
          const parsed = new URL(candidate)
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
          url = parsed.href
        } catch {
          continue
        }

        if (seen.has(url)) continue
        seen.add(url)
        links.push({ url })
      }
    }
  }

  return links
}

export default Plugin.define({
  id: "opencode-quick-links",
  setup(ctx) {
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
        placeholder: "Search links",
        options: links.map((link) => ({ title: link.url, value: link.url })),
      })
      if (!url) return
      await open(url).catch(() => {
        ctx.ui.toast.show({ variant: "warning", title: "Could not open browser", message: url })
      })
    }

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "quick-links.open",
          title: "Open session links",
          group: "Plugin",
          palette: true,
          slash: { name: "links" },
          run: () => showQuickLinks().catch(() => {
            ctx.ui.toast.show({ variant: "error", message: "Could not load session links." })
          }),
        },
      ],
      bindings: ["quick-links.open"],
    }))
  },
})

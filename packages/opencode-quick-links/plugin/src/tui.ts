import { Plugin } from "@opencode/plugin/tui"
import open from "open"

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING_PUNCTUATION = /[\],.;:!?}*]+$/

type QuickLink = {
  url: string
}

function trimLink(url: string) {
  let depth = 0

  for (let index = 0; index < url.length; index++) {
    if (url[index] === "(") depth++
    if (url[index] !== ")") continue
    if (depth === 0) return url.slice(0, index).replace(TRAILING_PUNCTUATION, "")
    depth--
  }

  return url.replace(TRAILING_PUNCTUATION, "")
}

type Message = ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>[number]

function messageTexts(message: Message) {
  if (message.type === "user") return [message.text]
  if (message.type !== "assistant") return []
  return message.content.flatMap((part) => {
    if (part.type === "text") return [part.text]
    if (part.type !== "tool") return []
    if (part.state.status !== "completed" && part.state.status !== "error") return []
    return (part.state.content ?? []).flatMap((content) => content.type === "text" ? [content.text] : [])
  })
}

function extractLinks(messages: Message[]) {
  const urls: string[] = []

  for (const message of messages) {
    for (const text of messageTexts(message)) {
      for (const match of text.matchAll(URL_PATTERN)) {
        try {
          const parsed = new URL(trimLink(match[0]))
          if (parsed.protocol === "http:" || parsed.protocol === "https:") urls.push(parsed.href)
        } catch {}
      }
    }
  }

  const seen = new Set<string>()
  const links: QuickLink[] = []
  for (const url of urls.reverse()) {
    if (seen.has(url)) continue
    seen.add(url)
    links.push({ url })
  }

  return links
}

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

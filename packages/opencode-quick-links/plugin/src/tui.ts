import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import open from "open"

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING_PUNCTUATION = /[\],.;:!?}]+$/

type QuickLink = {
  url: string
}

function currentSessionID(route: { name: string; params?: Record<string, unknown> }) {
  if (route.name !== "session") return
  const sessionID = route.params?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
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

function extractLinks(
  messages: Array<{
    parts: Array<{ type: string; text?: string }>
  }>,
) {
  const seen = new Set<string>()
  const links: QuickLink[] = []

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "text" || typeof part.text !== "string") continue

      for (const match of part.text.matchAll(URL_PATTERN)) {
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

export default {
  id: "opencode-quick-links",
  tui: async (api) => {
    async function showQuickLinks() {
      const sessionID = currentSessionID(api.route.current)
      if (!sessionID) {
        api.ui.toast({ variant: "warning", message: "Start a session." })
        return
      }

      const result = await api.client.session.messages({ sessionID })
      if (result.error) {
        api.ui.toast({ variant: "error", message: "Could not load session links." })
        return
      }

      const links = extractLinks(result.data)
      if (links.length === 0) {
        api.ui.toast({ variant: "info", message: "No links found in this session." })
        return
      }

      api.ui.dialog.replace(() =>
        api.ui.DialogSelect({
          title: "Quick Links",
          placeholder: "Search links",
          options: links.map((link) => ({
            title: link.url,
            value: link.url,
          })),
          onSelect: (option) => {
            api.ui.dialog.clear()
            void open(option.value).catch(() => {
              api.ui.toast({ variant: "warning", title: "Could not open browser", message: option.value })
            })
          },
        }),
      )
    }

    function runQuickLinks() {
      void showQuickLinks().catch(() => {
        api.ui.toast({ variant: "error", message: "Could not load session links." })
      })
    }

    if (!api.command) throw new Error("opencode-quick-links requires the TUI command API")

    const dispose = api.command.register(() => [
      {
        title: "Open session links",
        value: "quick-links.open",
        category: "Plugin",
        slash: { name: "links" },
        onSelect: runQuickLinks,
      },
    ])

    api.lifecycle.onDispose(dispose)
  },
} satisfies TuiPluginModule

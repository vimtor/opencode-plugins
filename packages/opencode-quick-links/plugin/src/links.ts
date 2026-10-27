import type { Plugin } from "@opencode/plugin/tui"

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
  return message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
}

export function extractLinks(messages: Message[]) {
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

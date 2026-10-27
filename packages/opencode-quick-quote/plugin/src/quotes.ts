import type { Plugin } from "@opencode/plugin/tui"
import { lexer, type Tokens } from "marked"

type Message = ReturnType<Plugin.Context["data"]["session"]["message"]["list"]>[number]

/** The text of the latest assistant replies, oldest first. */
export function latestReplies(messages: readonly Message[]): string[] {
  const replies: string[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    // Group replies across background notifications, stopping at their user
    // prompt. While a new prompt is unanswered, keep the last available group.
    if (message.type === "user" && replies.length) break
    if (message.type !== "assistant") continue
    const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n")
    if (text.trim()) replies.push(text)
  }
  return replies.reverse()
}

export function paragraphs(text: string): string[] {
  return lexer(text.replace(/\r\n?/g, "\n")).flatMap((token) => {
    if (token.type === "space" || token.type === "hr" || token.type === "def") return []
    if (token.type === "list") return (token as Tokens.List).items.map((item) => item.raw.trimEnd())
    const raw = token.raw.replace(/^\n+/, "").trimEnd()
    return raw.trim() ? [raw] : []
  })
}

/** Input is obtained with getTextRange(), whose offsets are display columns. */
export function quoteTrigger(beforeCursor: string) {
  const lines = beforeCursor.split("\n")
  const line = lines.pop() ?? ""
  if (!/^>(?!>)/.test(line)) return

  let fence: { character: string; length: number } | undefined
  for (const previous of lines) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(previous)
    if (!match) continue
    if (!fence) {
      fence = { character: match[1][0], length: match[1].length }
    } else if (match[1][0] === fence.character && match[1].length >= fence.length && !match[2].trim()) {
      fence = undefined
    }
  }
  if (fence) return
  return { row: lines.length, query: line.slice(1).trim(), key: `${lines.length}:${line}` }
}

/** Fold accents so "spočítaj" matches a search for "spocitaj". */
function foldAccents(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "")
}

export function filterParagraphs(items: readonly string[], query: string): string[] {
  const words = foldAccents(query).toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    const text = foldAccents(item).toLocaleLowerCase()
    return words.every((word) => text.includes(word))
  })
}

export function blockquote(text: string) {
  return text.split("\n").map((line) => line ? `> ${line}` : ">").join("\n")
}

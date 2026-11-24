export type Block =
  | { type: "text"; text: string }
  | { type: "code"; code: string; language?: string }
  | { type: "image"; src: string; alt: string; width?: number; height?: number }
  | { type: "html"; html: string; height?: number }

export type Option = { id: string; title: string; tag?: string; blocks: Block[] }

export type Decision = {
  id: string
  axis: string
  question: string
  context?: string
  options: Option[]
}

export type Axis = { id: string; title: string }

export type Deck = {
  id: string
  title: string
  context?: string
  axes: Axis[]
  decisions: Decision[]
}

export type Pick = { left: string; right: string; chosen: string }

export type Outcome = {
  decision: string
  axis: string
  question: string
  chosen: { id: string; title: string; tag?: string }
  rejected: { id: string; title: string }[]
  picks: Pick[]
  skips: number
  note?: string
}

export type Result = {
  deck: string
  title: string
  decidedAt: string
  outcomes: Outcome[]
}

const ID = /^[a-z0-9][a-z0-9-]*$/

export class DeckError extends Error {}

function fail(path: string, message: string): never {
  throw new DeckError(`${path}: ${message}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object")
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, "must be a non-empty string")
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path)
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !(value > 0)) fail(path, "must be a positive number")
  return value
}

function id(value: unknown, path: string): string {
  const text = string(value, path)
  if (!ID.test(text)) fail(path, "must be lowercase letters, digits and dashes")
  return text
}

function list(value: unknown, path: string, min: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be a list")
  if (value.length < min) fail(path, `needs at least ${min}`)
  return value
}

function unique<T extends { id: string }>(items: T[], path: string): T[] {
  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) fail(`${path}[${index}].id`, `“${item.id}” is used twice`)
    seen.add(item.id)
  }
  return items
}

function parseBlock(value: unknown, path: string): Block {
  const block = record(value, path)
  switch (block.type) {
    case "text":
      return { type: "text", text: string(block.text, `${path}.text`) }
    case "code":
      return {
        type: "code",
        code: string(block.code, `${path}.code`),
        language: optionalString(block.language, `${path}.language`),
      }
    case "image":
      return {
        type: "image",
        src: string(block.src, `${path}.src`),
        alt: string(block.alt, `${path}.alt`),
        width: optionalNumber(block.width, `${path}.width`),
        height: optionalNumber(block.height, `${path}.height`),
      }
    case "html":
      return {
        type: "html",
        html: string(block.html, `${path}.html`),
        height: optionalNumber(block.height, `${path}.height`),
      }
    default:
      fail(`${path}.type`, "must be text, code, image or html")
  }
}

function tag(value: unknown, path: string): string | undefined {
  const text = optionalString(value, path)?.trim()
  if (text === undefined) return undefined
  if (/\s/.test(text) || text.length > 16) fail(path, "must be one word of at most 16 characters")
  return text
}

function parseOption(value: unknown, path: string): Option {
  const option = record(value, path)
  return {
    id: id(option.id, `${path}.id`),
    title: string(option.title, `${path}.title`),
    tag: tag(option.tag, `${path}.tag`),
    blocks: list(option.blocks ?? [], `${path}.blocks`, 0).map((block, index) =>
      parseBlock(block, `${path}.blocks[${index}]`),
    ),
  }
}

export function parseDeck(value: unknown): Deck {
  const deck = record(value, "deck")
  const axes = unique(
    list(deck.axes, "axes", 1).map((value, index) => {
      const axis = record(value, `axes[${index}]`)
      return { id: id(axis.id, `axes[${index}].id`), title: string(axis.title, `axes[${index}].title`) }
    }),
    "axes",
  )
  const decisions = unique(
    list(deck.decisions, "decisions", 1).map((value, index) => {
      const path = `decisions[${index}]`
      const decision = record(value, path)
      const axis = id(decision.axis, `${path}.axis`)
      if (!axes.some((item) => item.id === axis)) fail(`${path}.axis`, `“${axis}” isn't in axes`)
      return {
        id: id(decision.id, `${path}.id`),
        axis,
        question: string(decision.question, `${path}.question`),
        context: optionalString(decision.context, `${path}.context`),
        options: unique(
          list(decision.options, `${path}.options`, 2).map((option, index) =>
            parseOption(option, `${path}.options[${index}]`),
          ),
          `${path}.options`,
        ),
      }
    }),
    "decisions",
  )
  return {
    id: id(deck.id, "id"),
    title: string(deck.title, "title"),
    context: optionalString(deck.context, "context"),
    axes,
    decisions,
  }
}

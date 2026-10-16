export const MAX_MESSAGE_LENGTH = 16_000
export const POLL_TIMEOUT_MS = 25_000

export interface Message {
  readonly seq: number
  readonly text: string
}

export interface Poll {
  readonly messages: readonly Message[]
  readonly closed: boolean
}

export interface Invite {
  readonly url: string
  readonly token: string
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

export function formatInvite(invite: Invite) {
  return `${invite.url}/#${invite.token}`
}

export function parseInvite(value: string): Invite {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error("Invalid meetup invite: expected a URL like https://…/#token")
  }
  const token = url.hash.slice(1)
  if (!token) throw new Error("Invalid meetup invite: missing token after #")
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    throw new Error("Invalid meetup invite: only https URLs are allowed, except on loopback")
  return { url: url.origin, token }
}

export function cleanName(value: unknown) {
  if (typeof value !== "string") return "peer"
  const name = value.replace(/[^\p{L}\p{N} ._@-]/gu, "").trim().slice(0, 40)
  return name || "peer"
}

export function checkText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Meetup message must be non-empty text")
  if (value.length > MAX_MESSAGE_LENGTH)
    throw new Error(`Meetup message must be at most ${MAX_MESSAGE_LENGTH} characters`)
  return value
}

export const MAX_MESSAGE_LENGTH = 16_000
export const POLL_TIMEOUT_MS = 25_000

export interface Message {
  readonly seq: number
  readonly text: string
}

export interface Poll {
  readonly messages: readonly Message[]
  readonly closed: boolean
  readonly reason?: string
}

export interface Invite {
  readonly url: string
  readonly token: string
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

// Tailscale addresses come from 100.64.0.0/10, and MagicDNS names end in .ts.net. WireGuard already
// encrypts that traffic, so plain http is fine there.
export function isTailscale(hostname: string) {
  if (hostname.endsWith(".ts.net")) return true
  const parts = hostname.split(".").map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part)) && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127
}

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
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (LOOPBACK.has(url.hostname) || isTailscale(url.hostname))))
    throw new Error("Invalid meetup invite: only https URLs are allowed, except on loopback and Tailscale")
  return { url: url.origin, token }
}

const UNITS = { s: ["second", 1_000], m: ["minute", 60_000], h: ["hour", 3_600_000] } as const
// setTimeout overflows past 2^31 - 1 ms.
const MAX_TIMEOUT = 2 ** 31 - 1

export interface Expiry {
  readonly ms: number
  readonly label: string
}

export function parseExpiry(value: unknown): Expiry | undefined {
  if (value === undefined) value = "1h"
  if (value === "never") return undefined
  const match = typeof value === "string" ? /^(\d+)([smh])$/.exec(value) : null
  const amount = Number(match?.[1])
  if (!match || amount <= 0)
    throw new Error('opencode-agent-meetup expiry option must look like "30s", "15m", "2h", or "never"')
  const [unit, size] = UNITS[match[2] as keyof typeof UNITS]
  if (amount * size > MAX_TIMEOUT) throw new Error("opencode-agent-meetup expiry option must be at most 596h")
  return { ms: amount * size, label: `${amount} ${unit}${amount === 1 ? "" : "s"}` }
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

import { timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { checkText, cleanName, MAX_MESSAGE_LENGTH, POLL_TIMEOUT_MS, type Message, type Poll } from "./protocol.js"

const CLOSE_GRACE_MS = 2_000
// After the closing reply leaves this server, a tunnel still has to relay it before it closes.
const RELAY_MS = 500

export interface HostInput {
  readonly hostname: string
  readonly name: string
  readonly token: string
  /** How many guests can be in the meetup at once. */
  readonly guests: number
  readonly onJoin: (peer: string) => void
  readonly onMessage: (peer: string, text: string) => void
  readonly onLeave: (peer: string) => void
}

export type Host = Awaited<ReturnType<typeof startHost>>

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface Guest {
  readonly id: string
  readonly name: string
  /** Messages up to this seq were sent before the guest joined. */
  readonly since: number
  /** The last seq the guest has received. */
  after: number
}

interface Entry extends Message {
  /** The guest who sent it, who doesn't get it back. */
  readonly sender?: string
}

// A group chat: the host's messages go to every guest, and each guest's message goes to the host and
// the other guests. Each guest's random ID authorizes its requests alongside the invite token.
export async function startHost(input: HostInput) {
  const expected = Buffer.from(`Bearer ${input.token}`)
  const waiters = new Set<() => void>()
  const guests = new Map<string, Guest>()
  let log: Entry[] = []
  let seq = 0
  let closed = false
  let reason: string | undefined
  // Guests whose reply saying the meetup closed has been sent, so close() doesn't shut the server first.
  const informed = new Set<string>()
  let notified: () => void = () => {}
  const told = new Promise<void>((resolve) => (notified = resolve))
  const inform = (id: string) => {
    informed.add(id)
    if ([...guests.keys()].every((guest) => informed.has(guest))) notified()
  }

  const wake = () => {
    for (const waiter of waiters) waiter()
    waiters.clear()
  }

  const authorize = (request: IncomingMessage) => {
    const actual = Buffer.from(request.headers.authorization ?? "")
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new HttpError(401, "Invalid meetup token")
  }

  const claimed = (id: unknown) => {
    const guest = typeof id === "string" ? guests.get(id) : undefined
    if (!guest) throw new HttpError(403, "Not a member of this meetup")
    return guest
  }

  const post = (from: string, text: string, sender?: string) => {
    log.push({ seq: ++seq, from, text, ...(sender ? { sender } : {}) })
    wake()
  }

  // Drop what every guest has received.
  const prune = () => {
    const oldest = Math.min(...[...guests.values()].map((guest) => Math.max(guest.after, guest.since)))
    log = log.filter((entry) => entry.seq > oldest)
  }

  // Two people shouldn't look the same to the agents, so a repeated name gets a number.
  const unique = (wanted: string) => {
    const taken = new Set([input.name, ...[...guests.values()].map((guest) => guest.name)])
    let name = wanted
    for (let index = 2; taken.has(name); index++) name = `${wanted}-${index}`
    return name
  }

  const poll = async (request: IncomingMessage, url: URL): Promise<Poll> => {
    const guest = claimed(url.searchParams.get("guest"))
    guest.after = Math.max(guest.after, Number(url.searchParams.get("after") ?? 0))
    prune()
    const pending = () =>
      log
        .filter((entry) => entry.seq > Math.max(guest.after, guest.since) && entry.sender !== guest.id)
        .map(({ seq, from, text }) => ({ seq, from, text }))
    if (!pending().length && !closed) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          waiters.delete(done)
          request.off("close", done)
          resolve()
        }
        const timer = setTimeout(done, POLL_TIMEOUT_MS)
        waiters.add(done)
        request.once("close", done)
      })
    }
    return { messages: pending(), closed, ...(closed && reason ? { reason } : {}) }
  }

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    authorize(request)
    const url = new URL(request.url ?? "/", "http://meetup")
    const route = `${request.method} ${url.pathname}`
    if (route === "GET /v1/messages") {
      const body = await poll(request, url)
      const id = url.searchParams.get("guest")!
      if (body.closed) response.once("finish", () => inform(id))
      return send(response, 200, body)
    }
    if (closed) throw new HttpError(410, "Meetup ended")
    const body = route.startsWith("POST ") ? await readJson(request) : {}
    switch (route) {
      case "POST /v1/join": {
        if (typeof body.guest !== "string" || !body.guest) throw new HttpError(400, "Missing guest ID")
        let guest = guests.get(body.guest)
        if (!guest) {
          if (guests.size >= input.guests) throw new HttpError(409, "This meetup is full")
          guest = { id: body.guest, name: unique(cleanName(body.name)), since: seq, after: 0 }
          guests.set(guest.id, guest)
          input.onJoin(guest.name)
        }
        return send(response, 200, { name: input.name })
      }
      case "POST /v1/messages": {
        const member = claimed(body.guest)
        const text = checkText(body.text)
        input.onMessage(member.name, text)
        post(member.name, text, member.id)
        return send(response, 204)
      }
      case "POST /v1/leave": {
        const member = claimed(body.guest)
        guests.delete(member.id)
        prune()
        wake()
        input.onLeave(member.name)
        return send(response, 204)
      }
    }
    throw new HttpError(404, "Not found")
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent) return response.end()
      if (error instanceof HttpError) return send(response, error.status, { error: error.message })
      send(response, 500, { error: "Internal error" })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, input.hostname, () => resolve())
  })

  return {
    port: (server.address() as AddressInfo).port,
    peers: () => [...guests.values()].map((guest) => guest.name),
    send(text: string) {
      if (closed) throw new Error("Meetup ended")
      if (!guests.size) throw new Error("No one has joined this meetup yet")
      post(input.name, checkText(text))
    },
    async close(why?: string) {
      if (closed) return
      closed = true
      reason = why
      wake()
      if (guests.size) await Promise.race([told.then(() => delay(RELAY_MS)), delay(CLOSE_GRACE_MS)])
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections()
        setTimeout(() => {
          server.closeAllConnections()
          resolve()
        }, 1_000).unref()
      })
    },
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms).unref())
}

function send(response: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) return response.writeHead(status).end()
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const limit = MAX_MESSAGE_LENGTH * 4 + 1024
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, "Message too large")
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (value && typeof value === "object" && !Array.isArray(value)) return value
  } catch {}
  throw new HttpError(400, "Expected a JSON object")
}

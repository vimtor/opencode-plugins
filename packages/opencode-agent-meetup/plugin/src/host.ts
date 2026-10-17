import { timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { checkText, cleanName, MAX_MESSAGE_LENGTH, POLL_TIMEOUT_MS, type Message, type Poll } from "./protocol.js"

const CLOSE_GRACE_MS = 2_000

export interface HostInput {
  readonly hostname: string
  readonly name: string
  readonly token: string
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

// Only one guest at a time: the first join claims the meetup, and the guest's random ID
// authorizes every later request alongside the invite token.
export async function startHost(input: HostInput) {
  const expected = Buffer.from(`Bearer ${input.token}`)
  const waiters = new Set<() => void>()
  let guest: { id: string; name: string } | undefined
  let outbox: Message[] = []
  let seq = 0
  let closed = false
  let reason: string | undefined
  // Resolves once the guest has seen that the meetup closed, so close() doesn't shut the server first.
  let notified: () => void = () => {}
  const told = new Promise<void>((resolve) => (notified = resolve))

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
    if (!guest || guest.id !== id) throw new HttpError(403, "Not a member of this meetup")
    return guest
  }

  const poll = async (request: IncomingMessage, url: URL): Promise<Poll> => {
    claimed(url.searchParams.get("guest"))
    const after = Number(url.searchParams.get("after") ?? 0)
    outbox = outbox.filter((message) => message.seq > after)
    if (!outbox.length && !closed) {
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
    if (closed) notified()
    return { messages: outbox, closed, ...(closed && reason ? { reason } : {}) }
  }

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    authorize(request)
    const url = new URL(request.url ?? "/", "http://meetup")
    const route = `${request.method} ${url.pathname}`
    if (route === "GET /v1/messages") return send(response, 200, await poll(request, url))
    if (closed) throw new HttpError(410, "Meetup ended")
    const body = route.startsWith("POST ") ? await readJson(request) : {}
    switch (route) {
      case "POST /v1/join": {
        if (guest && guest.id !== body.guest) throw new HttpError(409, "Someone already joined this meetup")
        if (typeof body.guest !== "string" || !body.guest) throw new HttpError(400, "Missing guest ID")
        if (!guest) {
          guest = { id: body.guest, name: cleanName(body.name) }
          input.onJoin(guest.name)
        }
        return send(response, 200, { name: input.name })
      }
      case "POST /v1/messages": {
        const member = claimed(body.guest)
        input.onMessage(member.name, checkText(body.text))
        return send(response, 204)
      }
      case "POST /v1/leave": {
        const member = claimed(body.guest)
        guest = undefined
        outbox = []
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
    peer: () => guest?.name,
    send(text: string) {
      if (closed) throw new Error("Meetup ended")
      if (!guest) throw new Error("No one has joined this meetup yet")
      outbox.push({ seq: ++seq, text: checkText(text) })
      wake()
    },
    async close(why?: string) {
      if (closed) return
      closed = true
      reason = why
      wake()
      if (guest) await Promise.race([told, new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS).unref())])
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

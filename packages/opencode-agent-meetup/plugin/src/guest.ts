import { randomUUID } from "node:crypto"
import { checkText, cleanName, POLL_TIMEOUT_MS, type Invite, type Poll } from "./protocol.js"

export interface GuestInput {
  readonly invite: Invite
  readonly name: string
  readonly onMessage: (peer: string, text: string) => void
  readonly onClose: (reason: string) => void
}

export type Guest = Awaited<ReturnType<typeof joinHost>>

const MAX_FAILURES = 8

export async function joinHost(input: GuestInput) {
  const id = randomUUID()
  const controller = new AbortController()
  const headers = { authorization: `Bearer ${input.invite.token}`, "content-type": "application/json" }

  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(new URL(path, input.invite.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ guest: id, ...body }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(await errorMessage(response))
    return response
  }

  const joined = (await (await post("/v1/join", { name: input.name })).json()) as { name?: unknown }
  const peer = cleanName(joined.name)

  let ended = false
  const end = (reason: string) => {
    if (ended) return
    ended = true
    controller.abort()
    input.onClose(reason)
  }

  void (async () => {
    let after = 0
    let failures = 0
    while (!controller.signal.aborted) {
      try {
        const url = new URL("/v1/messages", input.invite.url)
        url.searchParams.set("guest", id)
        url.searchParams.set("after", String(after))
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(POLL_TIMEOUT_MS + 15_000)]),
        })
        if ([401, 403, 404, 410].includes(response.status)) return end(`${peer} ended the meetup`)
        if (!response.ok) throw new Error(await errorMessage(response))
        const poll = (await response.json()) as Poll
        failures = 0
        for (const message of poll.messages) {
          if (message.seq <= after) continue
          after = message.seq
          input.onMessage(peer, message.text)
        }
        if (poll.closed) return end(poll.reason ?? `${peer} ended the meetup`)
      } catch {
        if (controller.signal.aborted) return
        if (++failures >= MAX_FAILURES) return end(`Lost connection to ${peer}`)
        await sleep(Math.min(1_000 * 2 ** failures, 15_000), controller.signal)
      }
    }
  })()

  return {
    peer: () => peer,
    async send(text: string) {
      if (ended) throw new Error("Meetup ended")
      await post("/v1/messages", { text: checkText(text) })
    },
    async close() {
      if (ended) return
      ended = true
      controller.abort()
      await post("/v1/leave", {}).catch(() => undefined)
    },
  }
}

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
  return typeof body?.error === "string" ? body.error : `Meetup request failed with HTTP ${response.status}`
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

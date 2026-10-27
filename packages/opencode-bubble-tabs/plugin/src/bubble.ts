import type { Plugin } from "@opencode/plugin/tui"

const triggers = ["prompt", "done", "ask"] as const
export type Trigger = (typeof triggers)[number]

export function parseOn(value: unknown): ReadonlySet<Trigger> {
  if (value === undefined) return new Set(["done", "ask"])
  if (!Array.isArray(value) || !value.every((item) => triggers.includes(item))) {
    throw new Error('opencode-bubble-tabs on option must be an array of "prompt", "done", or "ask"')
  }
  return new Set(value)
}

type Data = Plugin.Context["data"]
export type Events = Pick<Data, "on"> & { readonly session: Pick<Data["session"], "root"> }

export function listen(data: Events, on: ReadonlySet<Trigger>, bubble: (sessionID: string) => void) {
  const root = (sessionID: string) => data.session.root(sessionID)

  // Subagent runs finish inside their parent's turn, so only root completions bubble.
  // Subagent questions and permissions block the parent, so they bubble its tab.
  const stops: (() => void)[] = []
  if (on.has("prompt")) {
    stops.push(data.on("session.inbox.enqueued", (event) => {
      if (event.data.item.type === "user") bubble(root(event.data.sessionID))
    }))
  }
  if (on.has("done")) {
    stops.push(
      data.on("session.execution.succeeded", (event) => bubble(event.data.sessionID)),
      data.on("session.execution.failed", (event) => bubble(event.data.sessionID)),
    )
  }
  if (on.has("ask")) {
    stops.push(
      data.on("permission.asked", (event) => bubble(root(event.data.sessionID))),
      data.on("form.created", (event) => bubble(root(event.data.form.sessionID))),
    )
  }
  return () => {
    for (const stop of stops) stop()
  }
}

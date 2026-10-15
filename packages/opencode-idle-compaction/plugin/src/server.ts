import { Plugin } from "@opencode/plugin"

const DEFAULT_IDLE_MINUTES = 54
const DEFAULT_MIN_TOKENS = 200_000

function parseNumber(name: string, value: unknown, fallback: number) {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`opencode-idle-compaction ${name} option must be a non-negative number`)
  }
  return value
}

export default Plugin.define({
  id: "idle-compaction",
  setup(ctx) {
    const idle = parseNumber("idleMinutes", ctx.options.idleMinutes, DEFAULT_IDLE_MINUTES) * 60_000
    const minTokens = parseNumber("minTokens", ctx.options.minTokens, DEFAULT_MIN_TOKENS)

    const context = new Map<string, number>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const compacting = new Set<string>()

    function cancel(sessionID: string) {
      clearTimeout(timers.get(sessionID))
      timers.delete(sessionID)
    }

    async function compact(sessionID: string) {
      timers.delete(sessionID)
      if ((context.get(sessionID) ?? 0) < minTokens) return
      const session = await ctx.session.get({ sessionID })
      // Subagent sessions are never resumed directly, so refreshing their cache is wasted spend.
      if (session.parentID) return
      context.delete(sessionID)
      await ctx.session.compact({ sessionID })
    }

    function schedule(sessionID: string) {
      cancel(sessionID)
      if ((context.get(sessionID) ?? 0) < minTokens) return
      timers.set(sessionID, setTimeout(() => {
        compact(sessionID).catch((error) => console.error("opencode-idle-compaction:", error))
      }, idle))
    }

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        switch (event.type) {
          case "session.step.ended": {
            // A compaction's own request reads the whole context; it says nothing about the session's size afterwards.
            if (compacting.has(event.data.sessionID)) break
            const { input, output, cache } = event.data.tokens
            context.set(event.data.sessionID, input + output + cache.read + cache.write)
            break
          }
          case "session.execution.succeeded":
          case "session.execution.failed":
          case "session.execution.interrupted":
            schedule(event.data.sessionID)
            break
          case "session.execution.started":
          case "session.inbox.enqueued":
            cancel(event.data.sessionID)
            break
          case "session.compaction.started":
            cancel(event.data.sessionID)
            compacting.add(event.data.sessionID)
            break
          // After a failed compaction, wait for the next turn rather than retrying every idle period.
          case "session.compaction.ended":
          case "session.compaction.failed":
          case "session.deleted":
            cancel(event.data.sessionID)
            compacting.delete(event.data.sessionID)
            context.delete(event.data.sessionID)
            break
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.error("opencode-idle-compaction:", error)
    })

    return () => {
      controller.abort()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  },
})

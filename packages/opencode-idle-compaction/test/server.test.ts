import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import idleCompaction from "opencode-idle-compaction"

type Event = { type: string; data: Record<string, unknown> }

const IDLE_MINUTES = 0.0005 // 30ms
const IDLE_WAIT = 60

async function setup(input: { options?: Record<string, unknown>; parents?: Record<string, string> } = {}) {
  const queue: Event[] = []
  let wake: (() => void) | undefined
  let signal: AbortSignal | undefined
  const compactions: string[] = []
  const cleanup = await idleCompaction.setup({
    options: { idleMinutes: IDLE_MINUTES, ...input.options },
    event: {
      subscribe: (options: { signal: AbortSignal }) => {
        signal = options.signal
        return {
          async *[Symbol.asyncIterator]() {
            while (!signal?.aborted) {
              const event = queue.shift()
              if (event) yield event
              else await new Promise<void>((resolve) => (wake = resolve))
            }
          },
        }
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, parentID: input.parents?.[sessionID] }),
      compact: async ({ sessionID }: { sessionID: string }) => { compactions.push(sessionID) },
    },
  } as unknown as Plugin.Context)
  const emit = async (type: string, data: Record<string, unknown>) => {
    queue.push({ type, data })
    wake?.()
    await Bun.sleep(0)
  }
  const step = (sessionID: string, input: number, read = 0) =>
    emit("session.step.ended", { sessionID, tokens: { input, output: 0, reasoning: 0, cache: { read, write: 0 } } })
  return {
    compactions,
    emit,
    step,
    signal: () => signal,
    cleanup: async () => { if (cleanup) await cleanup(); wake?.() },
  }
}

test("compacts a large session after it goes idle", async () => {
  const harness = await setup()
  await harness.step("ses_a", 1_000, 199_000)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  expect(harness.compactions).toEqual([])
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual(["ses_a"])
  await harness.cleanup()
})

test("ignores sessions below the token threshold", async () => {
  const harness = await setup()
  await harness.step("ses_a", 199_999)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual([])
  await harness.cleanup()
})

test.each(["session.execution.failed", "session.execution.interrupted"])("schedules after %s", async (type) => {
  const harness = await setup()
  await harness.step("ses_a", 250_000)
  await harness.emit(type, { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual(["ses_a"])
  await harness.cleanup()
})

test.each(["session.execution.started", "session.inbox.enqueued", "session.compaction.started", "session.compaction.ended", "session.deleted"])(
  "cancels on %s",
  async (type) => {
    const harness = await setup()
    await harness.step("ses_a", 250_000)
    await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
    await harness.emit(type, { sessionID: "ses_a" })
    await Bun.sleep(IDLE_WAIT)
    expect(harness.compactions).toEqual([])
    await harness.cleanup()
  },
)

test("skips subagent sessions", async () => {
  const harness = await setup({ parents: { ses_child: "ses_a" } })
  await harness.step("ses_child", 250_000)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_child" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual([])
  await harness.cleanup()
})

test("respects a custom token threshold", async () => {
  const harness = await setup({ options: { minTokens: 1_000 } })
  await harness.step("ses_a", 1_000)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual(["ses_a"])
  await harness.cleanup()
})

test("compacts once until the session grows again", async () => {
  const harness = await setup()
  await harness.step("ses_a", 250_000)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual(["ses_a"])
  await harness.cleanup()
})

test.each(["session.compaction.ended", "session.compaction.failed"])("does not compact again after %s", async (type) => {
  const harness = await setup()
  await harness.step("ses_a", 250_000)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual(["ses_a"])
  // The compaction's own request reports the full context it summarized.
  await harness.emit("session.compaction.started", { sessionID: "ses_a" })
  await harness.step("ses_a", 250_000)
  await harness.emit(type, { sessionID: "ses_a" })
  await harness.emit("session.execution.failed", { sessionID: "ses_a" })
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual(["ses_a"])
  await harness.cleanup()
})

test("stops listening and clears timers on cleanup", async () => {
  const harness = await setup()
  await harness.step("ses_a", 250_000)
  await harness.emit("session.execution.succeeded", { sessionID: "ses_a" })
  await harness.cleanup()
  expect(harness.signal()?.aborted).toBe(true)
  await Bun.sleep(IDLE_WAIT)
  expect(harness.compactions).toEqual([])
})

test.each([["idleMinutes", -1], ["idleMinutes", "54"], ["minTokens", Number.NaN], ["minTokens", null]])("rejects invalid %s option %p", (name, value) => {
  expect(() => idleCompaction.setup({ options: { [name]: value } } as unknown as Plugin.Context)).toThrow(
    `opencode-idle-compaction ${name} option must be a non-negative number`,
  )
})

import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import supervisor from "opencode-supervisor"

const base = { model: "anthropic/claude-haiku-4-5", instructions: "Never touch the production database." }

const allow = '{"verdict":"allow"}'
const block = (reason: string) => JSON.stringify({ verdict: "block", reason })

type Hook = (event: any) => Promise<void> | void

async function setup(options: Record<string, unknown>, replies: Array<string | Error | Promise<string>> = []) {
  const hooks = new Map<string, Hook>()
  const prompts: string[] = []
  const models: unknown[] = []
  const interrupts: string[] = []
  const notices: Array<{ text: string; description: string; resume: boolean }> = []
  const events: any[] = []
  let push: (() => void) | undefined
  let interrupted = true

  async function* subscribe({ signal }: { signal: AbortSignal }) {
    while (!signal.aborted) {
      const event = events.shift()
      if (event) yield event
      else await new Promise<void>((resolve) => (push = resolve))
    }
  }

  const cleanup = await supervisor.setup({
    options,
    location: { directory: "/project" },
    session: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`session.${name}`, callback)
        return { dispose: async () => {} }
      },
      context: async () => [
        { type: "user", text: "Clean up old rows" },
        {
          type: "assistant",
          content: [
            { type: "reasoning", text: "hidden" },
            { type: "text", text: "Checking the tables" },
            { type: "tool", name: "bash", state: { input: { command: "psql -l" } } },
          ],
        },
      ],
      interrupt: async ({ sessionID }: { sessionID: string }) => {
        interrupts.push(sessionID)
        return { interrupted }
      },
      synthetic: async (input: { text: string; description: string; resume: boolean }) => {
        notices.push({ text: input.text, description: input.description, resume: input.resume })
      },
    },
    tool: {
      hook: async (name: string, callback: Hook) => {
        hooks.set(`tool.${name}`, callback)
        return { dispose: async () => {} }
      },
    },
    event: { subscribe },
    generate: {
      text: async (input: { prompt: string; model: unknown }) => {
        prompts.push(input.prompt)
        models.push(input.model)
        const reply = replies.shift() ?? allow
        if (reply instanceof Error) throw reply
        return { text: await reply }
      },
    },
  } as unknown as Plugin.Context)

  return {
    hooks,
    prompts,
    models,
    interrupts,
    notices,
    cleanup: cleanup as (() => void) | undefined,
    idle() {
      interrupted = false
    },
    prompt: (text: string, sessionID = "ses_a") =>
      hooks.get("session.prompt")!({ sessionID, messageID: "msg_a", prompt: { text }, delivery: "steer" }),
    tool: (tool: string, input: unknown, sessionID = "ses_a") =>
      hooks.get("tool.execute.before")!({ tool, input, sessionID, agent: "build", messageID: "msg_b", id: "call_a" }),
    emit(event: unknown) {
      events.push(event)
      push?.()
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test("requires a model and instructions", async () => {
  await expect(setup({ instructions: "x" })).rejects.toThrow("model option")
  await expect(setup({ model: "anthropic/claude-haiku-4-5" })).rejects.toThrow("instructions option")
  await expect(setup({ ...base, mode: "fast" })).rejects.toThrow("mode option")
  await expect(setup({ ...base, scope: ["files"] })).rejects.toThrow("scope option")
})

test("blocking mode lets allowed tool calls run", async () => {
  const harness = await setup(base, [allow])
  await harness.tool("bash", { command: "ls" })
  expect(harness.models).toEqual([{ providerID: "anthropic", id: "claude-haiku-4-5" }])
  expect(harness.interrupts).toEqual([])
})

test("sends the instructions, recent conversation, and tool call to the supervisor", async () => {
  const harness = await setup(base, [allow])
  await harness.tool("bash", { command: "ls" })
  const prompt = harness.prompts[0]!
  expect(prompt).toContain("Never touch the production database.")
  expect(prompt).toContain("User: Clean up old rows")
  expect(prompt).toContain("Assistant: Checking the tables")
  expect(prompt).toContain('Tool call bash: {"command":"psql -l"}')
  expect(prompt).not.toContain("hidden")
  expect(prompt).toContain('<review type="tool" tool="bash">\n{"command":"ls"}\n</review>')
})

test("blocking mode stops the run on a blocked tool call", async () => {
  const harness = await setup(base, [block("Touches production")])
  await expect(harness.tool("bash", { command: "psql prod" })).rejects.toThrow("Touches production")
  expect(harness.interrupts).toEqual(["ses_a"])
  expect(harness.notices).toEqual([
    {
      text: "Supervisor stopped the run: Touches production",
      description: "Supervisor stopped the run: Touches production",
      resume: false,
    },
  ])
})

test("deny fails only the tool call", async () => {
  const harness = await setup({ ...base, action: "deny" }, [block("Touches production")])
  await expect(harness.tool("bash", { command: "psql prod" })).rejects.toThrow(
    "Supervisor blocked this tool call: Touches production",
  )
  expect(harness.interrupts).toEqual([])
  expect(harness.notices).toEqual([])
})

test("skips ignored tools", async () => {
  const harness = await setup({ ...base, ignore: ["read"] }, [block("no")])
  await harness.tool("read", { path: "a.ts" })
  expect(harness.prompts).toEqual([])
})

test("blocking mode rejects a blocked prompt", async () => {
  const harness = await setup(base, [block("Asks for production access")])
  await expect(harness.prompt("drop prod")).rejects.toThrow("Supervisor blocked this prompt")
  expect(harness.interrupts).toEqual(["ses_a"])
  expect(harness.notices[0]?.text).toBe("Supervisor blocked a prompt: Asks for production access")
})

test("streaming mode reviews tool calls in the background", async () => {
  const harness = await setup({ ...base, mode: "streaming", action: "deny" }, [block("Touches production")])
  await harness.tool("bash", { command: "psql prod" })
  await flush()
  expect(harness.interrupts).toEqual(["ses_a"])
  expect(harness.notices[0]?.text).toBe("Supervisor stopped the run: Touches production")
})

test("streaming mode ignores verdicts from an earlier turn", async () => {
  let release: (text: string) => void = () => {}
  const late = new Promise<string>((resolve) => (release = resolve))
  const harness = await setup({ ...base, mode: "streaming", scope: ["tools"] }, [late])
  await harness.prompt("first")
  await harness.tool("bash", { command: "psql prod" })
  await harness.prompt("second")
  release(block("late"))
  await flush()
  expect(harness.interrupts).toEqual([])
})

test("reports replies after they stream", async () => {
  const harness = await setup({ ...base, scope: ["replies"] }, [block("Leaks a password")])
  harness.idle()
  harness.emit({ type: "session.text.ended", location: { directory: "/other" }, data: { sessionID: "ses_b", text: "x" } })
  harness.emit({
    type: "session.text.ended",
    location: { directory: "/project" },
    data: { sessionID: "ses_a", text: "The password is hunter2" },
  })
  await flush()
  await flush()
  harness.cleanup?.()
  expect(harness.prompts).toHaveLength(1)
  expect(harness.prompts[0]).toContain('<review type="reply">\nThe password is hunter2\n</review>')
  expect(harness.notices[0]?.text).toBe("Supervisor flagged the last turn: Leaks a password")
  expect(harness.hooks.has("tool.execute.before")).toBe(false)
})

test("fallback decides when the supervisor fails", async () => {
  const open = await setup(base, [new Error("overloaded")])
  await open.tool("bash", { command: "ls" })
  expect(open.interrupts).toEqual([])

  const closed = await setup({ ...base, fallback: "block" }, [new Error("overloaded")])
  await expect(closed.tool("bash", { command: "ls" })).rejects.toThrow("could not review it (overloaded)")

  const unreadable = await setup({ ...base, fallback: "block" }, ["sure, looks fine"])
  await expect(unreadable.tool("bash", { command: "ls" })).rejects.toThrow("unreadable verdict")
})

import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { SessionPrompt } from "@opencode/plugin/promise/session"
import exitPlan from "opencode-exit-plan"

type Agent = Awaited<ReturnType<Plugin.Context["agent"]["list"]>>["data"][number]
type HarnessOptions = {
  options?: { agent?: string; phrases?: string[] }
  agent?: string
  target?: Partial<Agent>
}

async function planHarness({ options = {}, agent = "plan", target = {} }: HarnessOptions = {}) {
  const switches: Array<Parameters<Plugin.Context["session"]["switchAgent"]>[0]> = []
  const location = { directory: "/project/worktree" }
  let prompt!: (event: SessionPrompt) => Promise<void> | void
  await exitPlan.setup({
    options,
    session: {
      hook: async (name: string, callback: typeof prompt) => {
        expect(name).toBe("prompt")
        prompt = callback
      },
      get: async () => ({ agent, location }),
      switchAgent: async (input: (typeof switches)[number]) => { switches.push(input) },
    },
    agent: {
      list: async (input: Parameters<Plugin.Context["agent"]["list"]>[0]) => {
        expect(input).toEqual({ location })
        return { data: [{ id: "build", name: "Builder", hidden: false, mode: "primary", ...target }] }
      },
    },
  } as unknown as Plugin.Context)
  return { switches, prompt: (text: string) => prompt({ sessionID: "session", prompt: { text } } as SessionPrompt) }
}

test("switches by agent ID at the session location and preserves ordinary prompts", async () => {
  const harness = await planHarness()
  await harness.prompt("Explain the plan")
  expect(harness.switches).toEqual([])
  await harness.prompt("  GO   AHEAD  ")
  expect(harness.switches).toEqual([{ sessionID: "session", agent: "build" }])
})

test("respects custom phrases, target eligibility, and current agent", async () => {
  const custom = await planHarness({ options: { agent: "review", phrases: ["  READY  NOW "] }, target: { id: "review" } })
  await custom.prompt("go ahead")
  expect(custom.switches).toEqual([])
  await custom.prompt("ready now")
  expect(custom.switches[0].agent).toBe("review")

  const cases: HarnessOptions[] = [{ agent: "build" }, { target: { hidden: true } }, { target: { mode: "subagent" } }, { target: { id: "other" } }]
  for (const input of cases) {
    const harness = await planHarness(input)
    await harness.prompt("go ahead")
    expect(harness.switches).toEqual([])
  }
})

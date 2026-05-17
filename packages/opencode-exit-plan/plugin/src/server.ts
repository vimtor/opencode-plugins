import type { PluginModule } from "@opencode-ai/plugin"

const PLAN_AGENT = "plan"
const DEFAULT_EXIT_PLAN_AGENT = "build"
const DEFAULT_EXIT_PLAN_PHRASES = [
  "go ahead",
  "go for it",
  "let's do it",
  "lets do it",
  "let's implement",
  "lets implement",
  "start implementing",
  "please implement",
  "implement this",
  "implement it",
  "implement the plan",
  "go implement",
  "execute the plan",
  "proceed with implementation",
  "make the changes",
  "apply the changes",
  "build it",
  "ship it",
  "lgtm",
  "approved",
] as const

export default {
  id: "exit-plan",
  server: async ({ client }, options = {}) => {
    const normalizeText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()
    const exitPlanAgent = (typeof options.agent === "string" && options.agent.trim()) || DEFAULT_EXIT_PLAN_AGENT
    const configuredPhrases = (options.phrases as string[] | undefined)?.map(normalizeText).filter(Boolean)
    const exitPlanPhrases = configuredPhrases?.length ? configuredPhrases : DEFAULT_EXIT_PLAN_PHRASES

    return {
      "chat.message": async (input, output) => {
        if ((input.agent ?? output.message.agent) !== PLAN_AGENT) return

        const userText = normalizeText(
          output.parts.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : [])).join("\n"),
        )
        if (!exitPlanPhrases.some((phrase) => userText.includes(phrase))) return

        const agents = await client.app
          .agents()
          .then((result) =>
            result.data?.filter((agent) => !("hidden" in agent && agent.hidden === true) && agent.mode !== "subagent"),
          )
          .catch(() => undefined)
        if (agents && !agents.some((agent) => agent.name === exitPlanAgent)) return

        output.message.agent = exitPlanAgent

        const names = agents?.map((agent) => agent.name)
        const plan = names?.indexOf(PLAN_AGENT) ?? -1
        const target = names?.indexOf(exitPlanAgent) ?? -1
        const cycles = names && plan >= 0 && target >= 0 ? (target - plan + names.length) % names.length : 1

        try {
          for (let i = 0; i < cycles; i++) {
            await client.tui.executeCommand({ body: { command: "agent_cycle" } })
          }
        } catch {
          // The message agent is already switched; stale TUI selection should not block the request.
        }
      },
    }
  },
} satisfies PluginModule

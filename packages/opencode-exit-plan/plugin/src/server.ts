import { Plugin } from "@opencode/plugin"
import { DEFAULT_EXIT_PLAN_PHRASES } from "./phrases.js"

const PLAN_AGENT = "plan"
const DEFAULT_EXIT_PLAN_AGENT = "build"

export default Plugin.define({
  id: "exit-plan",
  async setup(ctx) {
    const options = ctx.options
    const normalizeText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()
    const exitPlanAgent = (typeof options.agent === "string" && options.agent.trim()) || DEFAULT_EXIT_PLAN_AGENT
    const configuredPhrases = (options.phrases as string[] | undefined)?.map(normalizeText).filter(Boolean)
    const exitPlanPhrases = configuredPhrases?.length ? configuredPhrases : DEFAULT_EXIT_PLAN_PHRASES

    await ctx.session.hook("prompt", async (event) => {
      const userText = normalizeText(event.prompt.text)
      if (!exitPlanPhrases.some((phrase) => userText.includes(phrase))) return

      const session = await ctx.session.get({ sessionID: event.sessionID })
      if (session.agent !== PLAN_AGENT) return

      const { data: agents } = await ctx.agent.list({ location: session.location })
      if (!agents.some((agent) => agent.id === exitPlanAgent && !agent.hidden && agent.mode !== "subagent")) return

      await ctx.session.switchAgent({ sessionID: event.sessionID, agent: exitPlanAgent })
    })
  },
})

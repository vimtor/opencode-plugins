import { Plugin } from "@opencode/plugin"
import { DeckError, parseDeck } from "./deck.js"
import type { State } from "./run.js"
import { Settle, type Entry, type Opened } from "./rpc.js"

const id = { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", description: "Lowercase letters, digits and dashes." }

const block = {
  type: "object",
  description:
    "One piece of an option. text: Markdown. code: a snippet with its language. html: a mockup rendered in a sandboxed iframe with no scripts, on the panel's own background and text colour (light or dark, following the app); set your own background if the mockup needs one. It grows to fit its content; height is only the size it starts at. image: an https or data: URL, shown at its own size or the width and height you give, never wider than the card.",
  properties: {
    type: { type: "string", enum: ["text", "code", "html", "image"] },
    text: { type: "string" },
    code: { type: "string" },
    language: { type: "string" },
    html: { type: "string" },
    height: { type: "number" },
    src: { type: "string" },
    alt: { type: "string" },
  },
  required: ["type"],
  additionalProperties: false,
}

const INPUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "What the decisions are about, in a few words." },
    context: { type: "string", description: "One or two sentences of background, shown above every decision." },
    axes: {
      type: "array",
      description: "Groups of decisions, such as how it looks, how it behaves, how it's built.",
      items: {
        type: "object",
        properties: { id, title: { type: "string" } },
        required: ["id", "title"],
        additionalProperties: false,
      },
      minItems: 1,
    },
    decisions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id,
          axis: { ...id, description: "The id of one of the axes." },
          question: { type: "string", description: "A plain question, such as “Where does the desktop app show the speed?”" },
          context: { type: "string", description: "Optional background for this decision only." },
          options: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                id,
                title: { type: "string", description: "A short name the user can read at a glance." },
                blocks: { type: "array", items: block },
              },
              required: ["id", "title", "blocks"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "axis", "question", "options"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "axes", "decisions"],
  additionalProperties: false,
} as const

const DESCRIPTION = `Put several open decisions in front of the user as a deck they settle in a panel beside the session. They see two options at a time and keep one until one is left, and can snooze a decision until later.

Use it instead of the question tool when there are several decisions, or when options are easier to judge by looking at them: UI mockups (html blocks), code (code blocks), or short write-ups (text blocks).

It does not wait. The deck opens in the panel and this tool returns at once. When they finish, their answers are attached to their next message, with anything they add. Carry on with work that doesn't depend on the answers, or end your turn.

Writing a good deck:
- Group decisions by axis, such as how it looks, how it behaves, how it's built, how it ships.
- 2–4 options per decision. Each option stands on its own: a short title, then the blocks that show it.
- Show, don't describe: an html mockup for anything visual, a code block for an API or config shape.
- Present the options evenly. Don't recommend one; the point is the user's own pick.`

export default Plugin.define({
  id: "settle",
  async setup(ctx) {
    const key = (deckID: string) => `deck/${deckID}`
    const load = async (deckID: string) => (await ctx.storage.get(key(deckID))) as Entry | undefined
    const store = (entry: Entry) => ctx.storage.set(key(entry.id), entry as unknown as Parameters<typeof ctx.storage.set>[1])

    const all = async () => {
      const entries: Entry[] = []
      let after: string | undefined
      do {
        const page = await ctx.storage.scan({ prefix: "deck/", after, limit: 100 })
        entries.push(...page.entries.map((entry) => entry.value as unknown as Entry))
        after = page.next
      } while (after)
      return entries
    }

    const rpc = await ctx.rpc.register(Settle, {
      list: async (input) => {
        const { sessionID } = input as { sessionID?: string }
        const entries = (await all()).filter((entry) => !sessionID || entry.sessionID === sessionID)
        return {
          decks: entries
            .sort((a, b) => b.created - a.created)
            .map((entry) => ({
              id: entry.id,
              title: entry.deck.title,
              status: entry.status === "sent" || entry.state?.queue.length === 0 ? "sent" : "open",
              sessionID: entry.sessionID,
            })),
        }
      },
      get: async (input, context) => {
        const { deckID } = input as { deckID: string }
        const entry = await load(deckID)
        if (!entry) return context.error("not_found", "No deck with that ID.", {})
        return entry
      },
      save: async (input, context) => {
        const { deckID, state } = input as { deckID: string; state: State }
        const entry = await load(deckID)
        if (!entry) return context.error("not_found", "No deck with that ID.", {})
        // Done follows the picks, so a save that lands after finish can't reopen the deck.
        await store({ ...entry, state, status: state.queue.length === 0 ? "sent" : "open" })
        return {}
      },
      finish: async (input, context) => {
        const { deckID, state } = input as { deckID: string; state: State }
        const entry = await load(deckID)
        if (!entry) return context.error("not_found", "No deck with that ID.", {})
        await store({ ...entry, state, status: "sent", sent: Date.now() })
        return {}
      },
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "settle",
        description: DESCRIPTION,
        input: INPUT,
        options: { codemode: false },
        execute: async (input, context) => {
          const deckID = `dk_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
          let deck
          try {
            deck = parseDeck({ ...(input as object), id: "deck" })
          } catch (error) {
            if (error instanceof DeckError) throw new Error(`The deck is invalid: ${error.message}`)
            throw error
          }
          const entry: Entry = {
            id: deckID,
            sessionID: context.sessionID,
            directory: ctx.location.directory,
            deck: { ...deck, id: deckID },
            status: "open",
            created: Date.now(),
          }
          await store(entry)
          await rpc.events.emit("opened", {
            deckID,
            sessionID: context.sessionID,
            directory: ctx.location.directory,
            title: deck.title,
          } satisfies Opened)
          const count = deck.decisions.length
          return {
            content: `Opened “${deck.title}” for the user to settle, with ${count} decision${count === 1 ? "" : "s"} (${deckID}). They're deciding in the panel beside the session, and their answers will be attached to their next message. Carry on with work that doesn't depend on the answers, or end your turn.`,
            metadata: { deckID },
          }
        },
      })
    })
  },
})

import { Rpc } from "@opencode/plugin/rpc"
import type { Deck } from "./deck.js"
import type { State } from "./run.js"

const object = { type: "object" } as const

export const Settle = Rpc.define({
  id: "settle",
  methods: {
    list: { input: object, output: object },
    get: { input: object, output: object, errors: { not_found: object } },
    save: { input: object, output: object, errors: { not_found: object } },
    finish: { input: object, output: object, errors: { not_found: object } },
  },
  events: {
    opened: { schema: object },
  },
})

export type Entry = {
  id: string
  sessionID: string
  directory: string
  deck: Deck
  state?: State
  status: "open" | "sent"
  created: number
  sent?: number
}

export type Opened = { deckID: string; sessionID: string; directory: string; title: string }

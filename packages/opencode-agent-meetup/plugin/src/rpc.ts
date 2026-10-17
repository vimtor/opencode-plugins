import { Rpc } from "@opencode/plugin/rpc"

const session = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false,
} as const

// Expected failures come back as `error` instead of RPC errors so the TUI can show them as-is.
const result = (properties: Record<string, unknown>) =>
  ({
    type: "object",
    properties: { error: { type: "string" }, ...properties },
    additionalProperties: false,
  }) as const

export const Meetup = Rpc.define({
  id: "agent-meetup",
  methods: {
    host: { input: session, output: result({ invite: { type: "string" } }) },
    join: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, invite: { type: "string" } },
        required: ["sessionID", "invite"],
        additionalProperties: false,
      },
      output: result({ peer: { type: "string" } }),
    },
    leave: { input: session, output: result({ left: { type: "boolean" } }) },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          kind: { type: "string", enum: ["joined", "left", "ended", "paused"] },
          peer: { type: "string" },
          reason: { type: "string" },
        },
        required: ["sessionID", "kind"],
        additionalProperties: false,
      },
    },
  },
})

export type MeetupResult = { error?: string; invite?: string; peer?: string; left?: boolean }

export type MeetupChanged = {
  sessionID: string
  kind: "joined" | "left" | "ended" | "paused"
  peer?: string
  reason?: string
}

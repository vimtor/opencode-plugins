import { Rpc } from "@opencode/plugin/rpc"

const session = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false,
} as const

const role = { type: "string", enum: ["host", "guest", "none"] } as const

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
    status: { input: session, output: result({ role, peer: { type: "string" } }) },
    host: { input: session, output: result({ invite: { type: "string" }, expires: { type: "string" } }) },
    join: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, invite: { type: "string" } },
        required: ["sessionID", "invite"],
        additionalProperties: false,
      },
      output: result({ peer: { type: "string" } }),
    },
    leave: { input: session, output: result({ role }) },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          role,
          kind: { type: "string", enum: ["opened", "joined", "left", "ended", "closed", "paused"] },
          peer: { type: "string" },
          reason: { type: "string" },
        },
        required: ["sessionID", "role", "kind"],
        additionalProperties: false,
      },
    },
  },
})

export type MeetupRole = "host" | "guest" | "none"

export type MeetupResult = { error?: string; invite?: string; expires?: string; peer?: string; role?: MeetupRole }

export type MeetupChanged = {
  sessionID: string
  role: MeetupRole
  kind: "opened" | "joined" | "left" | "ended" | "closed" | "paused"
  peer?: string
  reason?: string
}

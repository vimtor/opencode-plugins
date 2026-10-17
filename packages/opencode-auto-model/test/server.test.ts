import { afterEach, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import modelRouter from "opencode-auto-model"

type Ref = { providerID: string; id: string; variant?: string }
type Session = { id: string; parentID?: string; model?: Ref }
type Credential = { type: "key"; key: string } | { type: "oauth"; access: string; metadata?: Record<string, unknown> }

const model = (providerID: string, id: string, variants: string[] = [], input = 1, released = 1) => ({
  providerID,
  id,
  name: id,
  enabled: true,
  status: "active",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: variants.map((variant) => ({ id: variant })),
  time: { released },
  cost: [{ input, output: input * 5, cache: { read: 0, write: 0 } }],
  limit: { context: 200_000, output: 32_000 },
})

const catalog = () => [
  model("anthropic", "claude-opus-4-7", ["low", "medium", "high", "max"], 5, 3),
  model("openai", "gpt-5.5", ["none", "minimal", "low", "medium", "high", "xhigh"], 5, 2),
  model("openai", "gpt-6-luna", ["none", "low", "medium"], 0.1, 1),
]

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

async function setup(input: {
  options?: Record<string, unknown>
  sessions?: Record<string, Session>
  credentials?: Record<string, Credential>
  models?: ReturnType<typeof model>[]
  defaultModel?: Ref
  generate?: (input: { prompt: string; model: Ref }) => string
  jev?: (url: string, init: RequestInit) => Response
}) {
  const sessions: Record<string, Session> = structuredClone(input.sessions ?? { ses_a: { id: "ses_a", model: { providerID: "router", id: "auto" } } })
  const switched: { sessionID: string; model: Ref }[] = []
  const generated: { prompt: string; model: Ref }[] = []
  const requests: { url: string; headers: Record<string, string>; body: any }[] = []
  let providers: unknown[] = []
  let hook: ((event: { sessionID: string; prompt: { text: string } }) => Promise<void>) | undefined

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return input.jev?.(url, init) ?? Response.json({ answers: {} })
  }) as typeof fetch

  await modelRouter.setup({
    options: input.options ?? {},
    provider: {
      transform: async (callback: (editor: { add: (provider: unknown) => void }) => void) => {
        callback({ add: (provider) => providers.push(provider) })
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: async (name: string, callback: typeof hook) => {
        if (name === "prompt") hook = callback
        return { dispose: async () => {} }
      },
      get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID],
      switchModel: async ({ sessionID, model }: { sessionID: string; model: Ref }) => {
        switched.push({ sessionID, model })
        sessions[sessionID]!.model = model
      },
    },
    model: {
      list: async () => ({ data: [model("router", "auto"), ...(input.models ?? catalog())] }),
      default: async () => ({ data: input.defaultModel ?? null }),
    },
    integration: {
      connection: {
        active: async (id: string) => (input.credentials?.[id] ? { type: "credential", id } : undefined),
        resolve: async (connection: { id: string }) => input.credentials?.[connection.id],
      },
    },
    generate: {
      text: async (request: { prompt: string; model: Ref }) => {
        generated.push(request)
        return { text: input.generate?.(request) ?? "" }
      },
    },
  } as unknown as Plugin.Context)

  return {
    providers,
    switched,
    generated,
    requests,
    prompt: (text: string, sessionID = "ses_a") => hook!({ sessionID, prompt: { text } }),
  }
}

const jevAnswer = (model: string, effort?: string) => () =>
  Response.json({
    answers: {
      model: { type: "choice", choice: model, probabilities: {} },
      ...(effort ? { effort: { type: "choice", choice: effort, probabilities: {} } } : {}),
    },
  })

test("registers the router/auto model", async () => {
  const harness = await setup({})
  expect(harness.providers).toHaveLength(1)
  expect(harness.providers[0]).toMatchObject({
    info: { id: "router", name: "", activation: "enabled" },
    models: [{ providerID: "router", id: "auto", name: "Auto" }],
  })
})

test("uses a custom model name", async () => {
  const harness = await setup({ options: { name: "Auto Model" } })
  expect(harness.providers[0]).toMatchObject({ info: { name: "" }, models: [{ name: "Auto Model" }] })
})

test("routes the first prompt with Jev through the Console connection", async () => {
  const harness = await setup({
    credentials: { opencode: { type: "oauth", access: "token", metadata: { orgID: "org_1" } } },
    jev: jevAnswer("openai/gpt-5.5", "high"),
  })
  await harness.prompt("Fix the flaky auth test")
  expect(harness.requests).toHaveLength(1)
  const request = harness.requests[0]!
  expect(request.url).toBe("https://opencode.ai/inference/systemone/v1/systemone")
  expect(request.headers).toMatchObject({
    authorization: "Bearer token",
    "x-opencode-org-id": "org_1",
    "x-opencode-session": "ses_a",
  })
  expect(request.body.model).toBe("jev-1.13")
  expect(request.body.state).toBe("Fix the flaky auth test")
  expect(Object.keys(request.body.questions.model.criteria)).toEqual([
    "anthropic/claude-opus-4-7",
    "openai/gpt-5.5",
    "openai/gpt-6-luna",
  ])
  expect(Object.keys(request.body.questions.effort.criteria)).toEqual([
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ])
  expect(harness.switched).toEqual([{ sessionID: "ses_a", model: { providerID: "openai", id: "gpt-5.5", variant: "high" } }])

  await harness.prompt("Now add a test")
  expect(harness.requests).toHaveLength(1)
  expect(harness.switched).toHaveLength(1)
})

test("restricts candidates to configured models with descriptions", async () => {
  const harness = await setup({
    options: {
      models: {
        "anthropic/claude-opus-4-7#high": "hard debugging",
        "openai/gpt-5.5": "",
        "openai/gpt-5.5#ultra": "missing variant",
        "missing/model": "missing model",
      },
    },
    credentials: { opencode: { type: "key", key: "key" } },
    jev: jevAnswer("anthropic/claude-opus-4-7#high", "minimal"),
  })
  await harness.prompt("Why does the cache miss?")
  const request = harness.requests[0]!
  expect(request.body.questions.model.criteria).toEqual({
    "anthropic/claude-opus-4-7#high": "hard debugging",
    "openai/gpt-5.5": "gpt-5.5. $5/M input tokens, $25/M output tokens. 200k context",
  })
  expect(Object.keys(request.body.questions.effort.criteria)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
  expect(harness.switched[0]!.model).toEqual({ providerID: "anthropic", id: "claude-opus-4-7", variant: "high" })
})

test("maps the effort to the closest variant of the picked model", async () => {
  const harness = await setup({
    credentials: { opencode: { type: "key", key: "key" } },
    jev: jevAnswer("openai/gpt-6-luna", "xhigh"),
  })
  await harness.prompt("Plan the migration")
  expect(harness.switched[0]!.model).toEqual({ providerID: "openai", id: "gpt-6-luna", variant: "medium" })
})

test("uses Jev through OpenRouter without a Console connection", async () => {
  const harness = await setup({
    credentials: { openrouter: { type: "key", key: "sk-or" } },
    jev: jevAnswer("openai/gpt-6-luna", "low"),
  })
  await harness.prompt("Rename this variable")
  expect(harness.requests[0]!.url).toBe("https://openrouter.ai/api/v1/systemone")
  expect(harness.requests[0]!.body.model).toBe("typesafe/jev-1.14")
  expect(harness.requests[0]!.headers.authorization).toBe("Bearer sk-or")
  expect(harness.switched[0]!.model).toEqual({ providerID: "openai", id: "gpt-6-luna", variant: "low" })
})

test("asks a fast model when Jev is unavailable", async () => {
  const harness = await setup({
    generate: () => 'Sure: {"model": "anthropic/claude-opus-4-7", "effort": "max"}',
  })
  await harness.prompt("Redesign the plugin loader")
  expect(harness.requests).toHaveLength(0)
  expect(harness.generated).toHaveLength(1)
  expect(harness.generated[0]!.model).toEqual({ providerID: "openai", id: "gpt-6-luna", variant: "none" })
  expect(harness.generated[0]!.prompt).toContain("Redesign the plugin loader")
  expect(harness.generated[0]!.prompt).toContain("- openai/gpt-5.5: ")
  expect(harness.switched[0]!.model).toEqual({ providerID: "anthropic", id: "claude-opus-4-7", variant: "max" })
})

test("uses a configured decider model", async () => {
  const harness = await setup({
    options: { decider: "openai/gpt-5.5#minimal" },
    credentials: { opencode: { type: "key", key: "key" } },
    generate: () => "openai/gpt-6-luna",
  })
  await harness.prompt("Hi")
  expect(harness.requests).toHaveLength(0)
  expect(harness.generated[0]!.model).toEqual({ providerID: "openai", id: "gpt-5.5", variant: "minimal" })
  expect(harness.switched[0]!.model).toEqual({ providerID: "openai", id: "gpt-6-luna" })
})

test("uses the fallback when the decider fails or picks an unknown model", async () => {
  const failing = await setup({
    options: { fallback: "anthropic/claude-opus-4-7#high" },
    credentials: { opencode: { type: "key", key: "key" } },
    jev: () => new Response("unavailable", { status: 503 }),
  })
  const error = console.error
  console.error = () => {}
  await failing.prompt("Fix it").finally(() => (console.error = error))
  expect(failing.switched[0]!.model).toEqual({ providerID: "anthropic", id: "claude-opus-4-7", variant: "high" })

  const unknown = await setup({
    options: { models: { "openai/gpt-5.5#low": "", "anthropic/claude-opus-4-7": "" } },
    credentials: { opencode: { type: "key", key: "key" } },
    jev: jevAnswer("openai/gpt-7"),
  })
  await unknown.prompt("Fix it")
  expect(unknown.switched[0]!.model).toEqual({ providerID: "openai", id: "gpt-5.5", variant: "low" })
})

test("routes sessions that rely on router/auto as the default model", async () => {
  const harness = await setup({
    sessions: { ses_a: { id: "ses_a" } },
    defaultModel: { providerID: "router", id: "auto" },
    credentials: { opencode: { type: "key", key: "key" } },
    jev: jevAnswer("openai/gpt-6-luna"),
  })
  await harness.prompt("Hello")
  expect(harness.switched[0]!.model).toEqual({ providerID: "openai", id: "gpt-6-luna" })
})

test("leaves other sessions alone and gives subagents their parent's model", async () => {
  const harness = await setup({
    sessions: {
      ses_other: { id: "ses_other", model: { providerID: "openai", id: "gpt-5.5" } },
      ses_parent: { id: "ses_parent", model: { providerID: "anthropic", id: "claude-opus-4-7", variant: "high" } },
      ses_child: { id: "ses_child", parentID: "ses_parent", model: { providerID: "router", id: "auto" } },
    },
    credentials: { opencode: { type: "key", key: "key" } },
    jev: jevAnswer("openai/gpt-6-luna"),
  })
  await harness.prompt("Hello", "ses_other")
  await harness.prompt("Explore the repo", "ses_child")
  expect(harness.requests).toHaveLength(0)
  expect(harness.switched).toEqual([
    { sessionID: "ses_child", model: { providerID: "anthropic", id: "claude-opus-4-7", variant: "high" } },
  ])
})

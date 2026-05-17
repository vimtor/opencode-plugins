import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

const DEFAULT_HIDDEN = true
const DEFAULT_MESSAGE = "Continue."

type KeepGoingOptions = {
  hidden?: boolean
  message?: string
}

type CommandContext = {
  focused?: unknown
}

function focusedText(input: unknown) {
  if (!input || typeof input !== "object") return
  const value = (input as { plainText?: unknown }).plainText
  return typeof value === "string" ? value : undefined
}

function currentSessionID(route: { name: string; params?: Record<string, unknown> }) {
  if (route.name !== "session") return
  const sessionID = route.params?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function getHidden(options: KeepGoingOptions) {
  if (options.hidden === undefined) return DEFAULT_HIDDEN
  if (typeof options.hidden !== "boolean") throw new Error("opencode-keep-going hidden option must be a boolean")
  return options.hidden
}

function getMessage(options: KeepGoingOptions) {
  if (options.message === undefined) return DEFAULT_MESSAGE
  if (typeof options.message !== "string" || options.message.trim() === "") {
    throw new Error("opencode-keep-going message option must be a non-empty string")
  }
  return options.message
}

export default {
  id: "keep-going",
  tui: async (api, options = {}) => {
    const keepGoingOptions = options as KeepGoingOptions
    const hidden = getHidden(keepGoingOptions)
    const message = getMessage(keepGoingOptions)

    const dispose = api.keymap.registerLayer({
      priority: 1000,
      commands: [
        {
          name: "keep-going.send",
          title: "Keep Going",
          run: (context: CommandContext) => {
            const input = focusedText(context.focused)
            if (input === undefined || input.trim() !== "") return false

            const sessionID = currentSessionID(api.route.current)
            if (!sessionID) return false

            const session = api.state.session.get(sessionID)
            const model = session?.model

            void api.client.session.prompt({
              sessionID,
              agent: session?.agent,
              model: model ? { providerID: model.providerID, modelID: model.id } : undefined,
              variant: model?.variant,
              parts: [
                {
                  type: "text",
                  text: message,
                  synthetic: hidden,
                  metadata: { source: "opencode-keep-going" },
                },
              ],
            })
          },
        },
      ],
      bindings: [
        {
          key: "return",
          cmd: "keep-going.send",
          preventDefault: false,
          fallthrough: true,
        },
      ],
    })

    api.lifecycle.onDispose(dispose)
  },
} satisfies TuiPluginModule

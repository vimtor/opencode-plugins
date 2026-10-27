const DEFAULT_HIDDEN = true
const DEFAULT_MESSAGE = "Continue."

export type KeepGoingOptions = {
  hidden?: boolean
  message?: string
}

export function getHidden(options: KeepGoingOptions) {
  if (options.hidden === undefined) return DEFAULT_HIDDEN
  if (typeof options.hidden !== "boolean") throw new Error("opencode-keep-going hidden option must be a boolean")
  return options.hidden
}

export function getMessage(options: KeepGoingOptions) {
  if (options.message === undefined) return DEFAULT_MESSAGE
  if (typeof options.message !== "string" || options.message.trim() === "") {
    throw new Error("opencode-keep-going message option must be a non-empty string")
  }
  return options.message
}

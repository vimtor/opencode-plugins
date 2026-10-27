import { delimiter } from "node:path"
import { Command, Ipc, Plugin } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { lookup } from "./gh.js"

// Windows cannot run processes, so the main process runs gh for them.
const GitHub = Ipc.define({
  id: "opencode-pr-link.github",
  methods: {
    lookup: {
      input: Schema.String,
      output: Schema.Union([
        Schema.Struct({ url: Schema.String }),
        Schema.Struct({
          problem: Schema.Struct({
            variant: Schema.Literals(["warning", "error"]),
            title: Schema.String,
            message: Schema.String,
          }),
        }),
      ]),
    },
  },
})

export default Plugin.define({
  setup(ctx) {
    const keybind = ctx.options.keybind ?? false
    if (keybind !== false && (typeof keybind !== "string" || keybind.trim() === "")) {
      throw new Error("opencode-pr-link keybind option must be a non-empty string or false")
    }
    const github = ctx.main(GitHub)

    async function openPullRequest() {
      const session = ctx.sessions.current()
      if (!session) {
        ctx.toast.show({ title: "Open a session first." })
        return
      }
      const result = await github.lookup(session.directory)
      if ("problem" in result) {
        const { variant, title, message } = result.problem
        ctx.toast.show({ variant: variant === "warning" ? "default" : "error", title, description: message })
        return
      }
      ctx.system.openExternal(result.url)
    }

    ctx.add(Command, {
      id: "open",
      title: "Open pull request",
      keywords: "github pr branch",
      bind: typeof keybind === "string" && keybind !== "none" ? keybind : undefined,
      run: () =>
        openPullRequest().catch(() => {
          ctx.toast.show({ variant: "error", title: "Could not open pull request", description: "Something went wrong. Try again." })
        }),
    })
  },
  main(ctx) {
    // Apps opened from the macOS Dock or Finder get a minimal PATH without Homebrew, where gh usually lives.
    const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter)
    ctx.provide(GitHub, { lookup: (directory) => lookup(directory, (path) => path, { ...process.env, PATH }) })
  },
})

import { Plugin } from "@opencode/plugin/tui"
import { Blindfold, type SecretRequested } from "./rpc.js"

export default Plugin.define({
  id: "blindfold",
  setup(ctx) {
    const blindfold = ctx.client.rpc(Blindfold)
    type CallOptions = Parameters<typeof blindfold.list>[1]
    // Requests with an open dialog in this client.
    const open = new Set<string>()

    async function answer(request: SecretRequested, options: Parameters<typeof blindfold.submit>[1]) {
      const ack = (await blindfold.ack({ requestID: request.requestID }, options)) as { accepted: boolean }
      if (!ack.accepted) return
      while (true) {
        open.add(request.requestID)
        const value = await ctx.ui.dialog.prompt({
          title: `Enter ${request.name}`,
          description: request.reason,
          placeholder: "Secret value",
        })
        // Another client answered, or the request expired, while the dialog was open.
        if (!open.delete(request.requestID)) return
        if (value === undefined) {
          await blindfold.cancel({ requestID: request.requestID }, options)
          return
        }
        // Empty submissions reopen the dialog because a value is required.
        if (value === "") continue
        const reply = (await blindfold.submit({ requestID: request.requestID, value }, options)) as { accepted: boolean }
        if (reply.accepted) ctx.ui.toast.show({ variant: "success", message: `Secret ${request.name} stored.` })
        return
      }
    }

    const stopRequested = blindfold.events.on("requested", async (event) => {
      const request = event.data as SecretRequested
      try {
        await answer(request, { location: event.location })
      } catch {
        open.delete(request.requestID)
        ctx.ui.toast.show({ variant: "error", message: `Could not send secret ${request.name}.` })
      }
    })

    const stopResolved = blindfold.events.on("resolved", (event) => {
      if (open.delete((event.data as { requestID: string }).requestID)) ctx.ui.dialog.clear()
    })

    // Secrets live in the server plugin of the current session's location.
    async function target(): Promise<CallOptions> {
      const route = ctx.ui.router.current()
      if (route.type === "session" && !ctx.data.session.get(route.sessionID)) await ctx.data.session.sync(route.sessionID)
      const location = (route.type === "session" ? ctx.data.session.get(route.sessionID)?.location : undefined) ?? ctx.location
      return location ? { location } : undefined
    }

    async function showSecrets(options: CallOptions, current?: string) {
      const { names } = (await blindfold.list({}, options)) as { names: string[] }
      if (names.length === 0) {
        if (current !== undefined) ctx.ui.dialog.clear()
        ctx.ui.toast.show({ variant: "info", message: "No secrets stored." })
        return
      }
      await ctx.ui.dialog.select({
        title: "Secrets",
        placeholder: "Search secrets",
        options: names.map((name) => ({ title: name, value: name })),
        current: current && (names.find((name) => name >= current) ?? names.at(-1)),
        actions: [{ bind: "ctrl+d", title: "delete", onTrigger: (name) => void remove(name, options) }],
      })
    }

    async function remove(name: string, options: CallOptions) {
      try {
        const { accepted } = (await blindfold.remove({ name }, options)) as { accepted: boolean }
        if (accepted) ctx.ui.toast.show({ variant: "success", message: `Secret ${name} deleted.` })
        await showSecrets(options, name)
      } catch {
        ctx.ui.toast.show({ variant: "error", message: `Could not delete secret ${name}.` })
      }
    }

    const stopSlot = ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "blindfold.secrets",
              bind: false,
              title: "Show stored secrets",
              group: "Plugin",
              palette: true,
              slash: { name: "secrets" },
              run: async () => {
                try {
                  await showSecrets(await target())
                } catch {
                  ctx.ui.toast.show({ variant: "error", message: "Could not load secrets." })
                }
              },
            },
          ],
        }))
        return null
      },
    })

    return () => {
      stopRequested()
      stopResolved()
      stopSlot()
    }
  },
})

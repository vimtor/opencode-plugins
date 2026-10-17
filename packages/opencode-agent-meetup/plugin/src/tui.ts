import { Plugin } from "@opencode/plugin/tui"
import type { ToastOptions } from "@opencode/plugin/tui/context"
import { Meetup, type MeetupChanged, type MeetupResult } from "./rpc.js"

export default Plugin.define({
  id: "agent-meetup",
  setup(ctx) {
    const meetup = ctx.client.rpc(Meetup)
    const toast = (options: ToastOptions) => ctx.ui.toast.show({ title: "Meetup", ...options })

    async function current() {
      const route = ctx.ui.router.current()
      if (route.type !== "session") {
        toast({ variant: "warning", message: "Open a session first." })
        return
      }
      if (!ctx.data.session.get(route.sessionID)) await ctx.data.session.sync(route.sessionID)
      const location = ctx.data.session.get(route.sessionID)?.location
      return { sessionID: route.sessionID, options: location ? { location } : undefined }
    }

    function failed(result: MeetupResult) {
      if (!result.error) return false
      toast({ variant: "error", message: result.error })
      return true
    }

    async function host() {
      const target = await current()
      if (!target) return
      toast({ message: "Opening a tunnel. The first time can take a minute.", duration: 60_000 })
      const result = (await meetup.host({ sessionID: target.sessionID }, target.options)) as MeetupResult
      if (failed(result) || !result.invite) return
      const copied = ctx.renderer.copyToClipboardOSC52?.(result.invite) === true
      toast({ variant: "success", message: copied ? "Meetup open. Invite copied to the clipboard." : "Meetup open." })
      await ctx.ui.dialog.alert({
        title: "Meetup open",
        message: [
          "Share this invite with one coworker. They run /meetup-join and paste it.",
          "",
          result.invite,
          "",
          "Anyone with the invite can message this session until you run /meetup-leave.",
        ].join("\n"),
      })
    }

    async function join(argument?: string) {
      const target = await current()
      if (!target) return
      const invite =
        argument?.trim() ||
        (await ctx.ui.dialog.prompt({
          title: "Join a meetup",
          description: "Paste the invite your coworker shared.",
          placeholder: "https://….opentunnel.xyz/#…",
        }))?.trim()
      if (!invite) return
      const result = (await meetup.join({ sessionID: target.sessionID, invite }, target.options)) as MeetupResult
      if (failed(result)) return
      toast({ variant: "success", message: `Joined ${result.peer}'s meetup.` })
    }

    async function leave() {
      const target = await current()
      if (!target) return
      const result = (await meetup.leave({ sessionID: target.sessionID }, target.options)) as MeetupResult
      if (failed(result)) return
      toast({ message: result.left ? "You left the meetup." : "This session has no meetup." })
    }

    const run = (action: () => Promise<void>) => () =>
      action().catch((error: unknown) => {
        toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
      })

    const stopChanged = meetup.events.on("changed", (event) => {
      const data = event.data as MeetupChanged
      const title = ctx.data.session.get(data.sessionID)?.title
      const suffix = title ? ` in ${title}` : ""
      if (data.kind === "joined") toast({ variant: "success", message: `${data.peer} joined the meetup${suffix}.` })
      if (data.kind === "left") toast({ variant: "warning", message: `${data.peer} left the meetup${suffix}.` })
      if (data.kind === "ended") toast({ variant: "warning", message: `${data.reason ?? "Meetup ended"}${suffix}.` })
      if (data.kind === "paused")
        toast({
          variant: "warning",
          message: `Paused auto-replies to ${data.peer}${suffix}. Send a prompt to let the agents continue.`,
        })
    })

    const stopSlot = ctx.ui.slot({
      append: "app",
      render() {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "agent-meetup.host",
              title: "Host a meetup",
              group: "Meetup",
              palette: true,
              slash: { name: "meetup-host" },
              run: run(host),
            },
            {
              id: "agent-meetup.join",
              title: "Join a meetup",
              group: "Meetup",
              palette: true,
              slash: { name: "meetup-join", arguments: true },
              run: (input?: string) => run(() => join(input))(),
            },
            {
              id: "agent-meetup.leave",
              title: "Leave the meetup",
              group: "Meetup",
              palette: true,
              slash: { name: "meetup-leave" },
              run: run(leave),
            },
          ],
        }))
        return null
      },
    })

    return () => {
      stopChanged()
      stopSlot()
    }
  },
})

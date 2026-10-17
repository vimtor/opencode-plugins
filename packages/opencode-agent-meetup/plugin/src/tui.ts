import { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand, ToastOptions } from "@opencode/plugin/tui/context"
import { createEffect } from "solid-js"
import { Meetup, type MeetupChanged, type MeetupResult, type MeetupRole } from "./rpc.js"

const SLOW_HOST_MS = 1_000

export default Plugin.define({
  id: "agent-meetup",
  setup(ctx) {
    const meetup = ctx.client.rpc(Meetup)
    const [roles, updateRoles] = ctx.storage.memory("roles", { initial: {} as Record<string, MeetupRole> })
    const setRole = (sessionID: string, role: MeetupRole) => updateRoles((draft) => void (draft[sessionID] = role))
    const toast = (options: ToastOptions) => ctx.ui.toast.show({ title: "Meetup", ...options })

    const sessionID = () => {
      const route = ctx.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    async function target(id: string) {
      if (!ctx.data.session.get(id)) await ctx.data.session.sync(id)
      const location = ctx.data.session.get(id)?.location
      return location ? { location } : undefined
    }

    function failed(result: MeetupResult) {
      if (!result.error) return false
      toast({ variant: "error", message: result.error })
      return true
    }

    async function refresh(id: string) {
      const result = (await meetup.status({ sessionID: id }, await target(id))) as MeetupResult
      if (result.role) setRole(id, result.role)
    }

    async function host(id: string) {
      const options = await target(id)
      // Tailscale and an existing tunnel answer at once; only a new OpenTunnel tunnel is worth a heads-up.
      const slow = setTimeout(
        () => toast({ message: "Opening a tunnel. The first time can take a minute.", duration: 60_000 }),
        SLOW_HOST_MS,
      )
      const result = (await meetup.host({ sessionID: id }, options).finally(() => clearTimeout(slow))) as MeetupResult
      if (failed(result) || !result.invite) return
      setRole(id, "host")
      const copy = await ctx.ui.dialog.confirm({
        title: "Meetup open",
        message: [
          "Share with one coworker; they join with /meetup-join.",
          "",
          result.invite,
          "",
          result.expires
            ? `Anyone with it can message this session for ${result.expires}.`
            : "Anyone with it can message this session until you end it.",
        ].join("\n"),
        label: { confirm: "Copy", cancel: "Close" },
      })
      if (!copy) return
      if (ctx.renderer.copyToClipboardOSC52?.(result.invite)) toast({ variant: "success", message: "Invite copied." })
      else toast({ variant: "warning", message: "This terminal doesn't support copying. Select the invite instead." })
    }

    async function join(id: string) {
      const invite = (
        await ctx.ui.dialog.prompt({
          title: "Join a meetup",
          description: "Paste the invite your coworker shared.",
          placeholder: "https://….opentunnel.xyz/#…",
        })
      )?.trim()
      if (!invite) return
      const result = (await meetup.join({ sessionID: id, invite }, await target(id))) as MeetupResult
      if (failed(result)) return
      setRole(id, "guest")
      toast({ variant: "success", message: `Joined ${result.peer}'s meetup.` })
    }

    async function leave(id: string) {
      const result = (await meetup.leave({ sessionID: id }, await target(id))) as MeetupResult
      if (failed(result)) return
      setRole(id, "none")
      if (result.role === "host") toast({ message: "Meetup ended." })
      if (result.role === "guest") toast({ message: "You left the meetup." })
    }

    const run = (action: (id: string) => Promise<void>) => () => {
      const id = sessionID()
      if (!id) return toast({ variant: "warning", message: "Open a session first." })
      action(id).catch((error: unknown) => {
        toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
      })
    }

    const stopChanged = meetup.events.on("changed", (event) => {
      const data = event.data as MeetupChanged
      setRole(data.sessionID, data.role)
      const title = ctx.data.session.get(data.sessionID)?.title
      const suffix = title ? ` in ${title}` : ""
      if (data.kind === "joined" && data.role === "host")
        toast({ variant: "success", message: `${data.peer} joined the meetup${suffix}.` })
      if (data.kind === "left") toast({ variant: "warning", message: `${data.peer} left the meetup${suffix}.` })
      if (data.kind === "ended") toast({ variant: "warning", message: `${data.reason ?? "Meetup ended"}${suffix}.` })
      if (data.kind === "paused")
        toast({ variant: "warning", message: `Paused auto-replies to ${data.peer}${suffix}. Send a prompt to resume.` })
    })

    const commands = (role: MeetupRole | undefined): KeymapCommand[] => {
      if (role === "host")
        return [{ id: "agent-meetup.end", title: "End the meetup", group: "Meetup", palette: true, slash: { name: "meetup-end" }, run: run(leave) }]
      if (role === "guest")
        return [{ id: "agent-meetup.leave", title: "Leave the meetup", group: "Meetup", palette: true, slash: { name: "meetup-leave" }, run: run(leave) }]
      return [
        { id: "agent-meetup.host", title: "Host a meetup", group: "Meetup", palette: true, slash: { name: "meetup-host" }, run: run(host) },
        { id: "agent-meetup.join", title: "Join a meetup", group: "Meetup", palette: true, slash: { name: "meetup-join" }, run: run(join) },
      ]
    }

    const stopSlot = ctx.ui.slot({
      append: "app",
      render() {
        // A TUI that starts while the server already has a meetup learns the role on first visit.
        createEffect(() => {
          const id = sessionID()
          if (id && roles[id] === undefined) void refresh(id).catch(() => undefined)
        })
        ctx.keymap.layer(() => {
          const id = sessionID()
          return { mode: "global", commands: commands(id ? roles[id] : undefined) }
        })
        return null
      },
    })

    return () => {
      stopChanged()
      stopSlot()
    }
  },
})

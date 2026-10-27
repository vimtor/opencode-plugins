import { Command, createKeyed, Plugin, type MountedSession } from "@opencode/plugin/gui"
import { onCleanup } from "solid-js"
import { changeMessage, inviteMessage } from "./messages.js"
import { Meetup, type MeetupChanged, type MeetupResult, type MeetupRole } from "./rpc.js"

// The desktop app's own server, which runs this plugin's server part.
const SERVER = "sidecar"
const SLOW_HOST_MS = 1_000

export default Plugin.define({
  setup(ctx) {
    const [roles, updateRoles] = ctx.storage.memory("roles", { initial: {} as Record<string, MeetupRole> })
    const setRole = (sessionID: string, role: MeetupRole) => updateRoles((draft) => void (draft[sessionID] = role))
    const toast = (variant: "success" | "warning" | "error" | undefined, message: string) =>
      ctx.toast.show({ variant: variant === "warning" ? "default" : variant, title: "Meetup", description: message })
    const meetup = () => ctx.client.rpc(Meetup)

    // Meetups live on this app's server, so sessions on other servers have none.
    const current = () => {
      const session = ctx.sessions.current()
      return session?.server.id === SERVER ? session : undefined
    }
    const target = (session: MountedSession) => (session.location ? { location: session.location } : undefined)

    function failed(result: MeetupResult) {
      if (!result.error) return false
      toast("error", result.error)
      return true
    }

    async function host(session: MountedSession) {
      // Tailscale and an existing tunnel answer at once; only a new OpenTunnel tunnel is worth a heads-up.
      let opening: { dismiss(): void } | undefined
      const slow = setTimeout(() => {
        opening = ctx.toast.show({ variant: "loading", title: "Opening a tunnel. The first time can take a minute.", persistent: true })
      }, SLOW_HOST_MS)
      const result = (await meetup()
        .host({ sessionID: session.id }, target(session))
        .finally(() => {
          clearTimeout(slow)
          opening?.dismiss()
        })) as MeetupResult
      if (failed(result) || !result.invite) return
      setRole(session.id, "host")
      const copy = await ctx.dialogs.confirm({
        title: "Meetup open",
        description: inviteMessage(result.invite, result.expires),
        confirm: "Copy",
        cancel: "Close",
      })
      if (!copy) return
      await ctx.system.copy(result.invite)
      toast("success", "Invite copied.")
    }

    async function join(session: MountedSession) {
      const invite = (
        await ctx.dialogs.prompt({
          title: "Join a meetup",
          description: "Paste the meetup invite.",
          placeholder: "https://….opentunnel.xyz/#…",
          submit: "Join",
        })
      )?.trim()
      if (!invite) return
      const result = (await meetup().join({ sessionID: session.id, invite }, target(session))) as MeetupResult
      if (failed(result)) return
      setRole(session.id, "guest")
      toast("success", `Joined ${result.peer}'s meetup.`)
    }

    async function leave(session: MountedSession) {
      const result = (await meetup().leave({ sessionID: session.id }, target(session))) as MeetupResult
      if (failed(result)) return
      setRole(session.id, "none")
      if (result.role === "host") toast(undefined, "Meetup ended.")
      if (result.role === "guest") toast(undefined, "You left the meetup.")
    }

    const run = (action: (session: MountedSession) => Promise<void>) => () => {
      const session = current()
      if (!session) return
      action(session).catch((error: unknown) => toast("error", error instanceof Error ? error.message : String(error)))
    }

    // A window that opens while the server already has a meetup learns the role on first visit.
    createKeyed(
      current,
      (session) => {
        if (roles[session.id] !== undefined) return
        void meetup()
          .status({ sessionID: session.id }, target(session))
          .then((result) => {
            const role = (result as MeetupResult).role
            if (role) setRole(session.id, role)
          })
          .catch(() => undefined)
      },
      { equals: (previous, next) => previous.key === next.key },
    )

    createKeyed(
      () => ctx.client,
      (client) =>
        onCleanup(
          client.rpc(Meetup).events.on("changed", (event) => {
            const data = event.data as MeetupChanged
            setRole(data.sessionID, data.role)
            const change = changeMessage(data, ctx.servers.get(SERVER)?.data.session.get(data.sessionID)?.title)
            if (change) toast(change.variant, change.message)
          }),
        ),
    )

    const role = () => {
      const session = current()
      return session ? (roles[session.id] ?? "none") : undefined
    }
    const command = (id: string, title: string, slash: string, when: MeetupRole[], action: (session: MountedSession) => Promise<void>) =>
      ctx.add(Command, () => {
        const now = role()
        return { id, title, group: "Meetup", slash: { name: slash }, enabled: now !== undefined && when.includes(now), run: run(action) }
      })

    command("host", "Host a meetup", "meetup-host", ["none"], host)
    command("join", "Join a meetup", "meetup-join", ["none"], join)
    command("end", "End the meetup", "meetup-end", ["host"], leave)
    command("leave", "Leave the meetup", "meetup-leave", ["guest"], leave)
  },
})

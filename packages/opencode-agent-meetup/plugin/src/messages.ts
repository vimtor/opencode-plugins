import type { MeetupChanged } from "./rpc.js"

export function inviteMessage(invite: string, expires: string | undefined) {
  return [
    "Share this invite. Others join with /meetup-join.",
    "",
    invite,
    "",
    expires
      ? `Anyone with it can message this session for ${expires}.`
      : "Anyone with it can message this session until you end it.",
  ].join("\n")
}

export function changeMessage(data: MeetupChanged, title: string | undefined) {
  const suffix = title ? ` in ${title}` : ""
  if (data.kind === "joined" && data.role === "host")
    return { variant: "success" as const, message: `${data.peer} joined the meetup${suffix}.` }
  if (data.kind === "left") return { variant: "warning" as const, message: `${data.peer} left the meetup${suffix}.` }
  if (data.kind === "ended") return { variant: "warning" as const, message: `${data.reason ?? "Meetup ended"}${suffix}.` }
  if (data.kind === "paused")
    return { variant: "warning" as const, message: `Paused auto-replies to ${data.peer}${suffix}. Send a prompt to resume.` }
}

import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"

export type Mode = "opentunnel" | "tailscale" | "local"

export interface Exposure {
  readonly url: string
  readonly close: () => Promise<void>
}

// Where the message server listens. Only Tailscale listens on a non-loopback address, and only on the
// device's Tailscale address, so the server is never reachable from other networks.
export async function listenAddress(mode: Mode) {
  if (mode !== "tailscale") return "127.0.0.1"
  return tailscaleAddress()
}

export async function expose(mode: Mode, hostname: string, port: number): Promise<Exposure> {
  if (mode === "opentunnel") return openTunnel(port)
  return { url: `http://${hostname}:${port}`, close: async () => {} }
}

// Shares the device's OpenTunnel tunnel (the same one `opencode pair --remote` uses) and claims a
// random route on it. The route keeps the URL unguessable; the invite token is the actual auth.
async function openTunnel(port: number): Promise<Exposure> {
  const { create } = await import("@opentunnel/client")
  const client = create()
  const route = randomBytes(8).toString("hex")
  try {
    const connection = await client.tunnel.connect({ routes: { [route]: `127.0.0.1:${port}` } })
    return {
      url: `https://${route}.${connection.tunnel.hostname}`,
      async close() {
        await connection.close().catch(() => undefined)
        await client.dispose().catch(() => undefined)
      },
    }
  } catch (error) {
    await client.dispose().catch(() => undefined)
    throw error
  }
}

// The macOS app ships its CLI inside the bundle and doesn't always put `tailscale` on PATH.
const TAILSCALE = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]

async function tailscaleAddress() {
  for (const command of TAILSCALE) {
    const output = await new Promise<string | undefined>((resolve) => {
      execFile(command, ["ip", "-4"], { timeout: 5_000 }, (error, stdout) => resolve(error ? undefined : stdout))
    })
    const address = output?.split("\n").map((line) => line.trim()).find(Boolean)
    if (address) return address
  }
  throw new Error("Couldn't get this device's Tailscale address. Is Tailscale installed and connected?")
}

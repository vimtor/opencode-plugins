import { randomBytes } from "node:crypto"

export interface Tunnel {
  readonly url: string
  readonly close: () => Promise<void>
}

// Shares the device's OpenTunnel tunnel (the same one `opencode pair --remote` uses) and claims a
// random route on it. The route keeps the URL unguessable; the invite token is the actual auth.
export async function openTunnel(port: number): Promise<Tunnel> {
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

export function loopback(port: number): Tunnel {
  return { url: `http://127.0.0.1:${port}`, close: async () => {} }
}

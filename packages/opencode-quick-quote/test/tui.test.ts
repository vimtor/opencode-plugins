import { afterEach, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { BoxRenderable, TextareaRenderable, TextRenderable, RGBA, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapLayer, SlotClaim } from "@opencode/plugin/tui/context"
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui"
import quickQuote from "opencode-quick-quote/tui"

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

test("loads through a local directory as well as npm exports", async () => {
  const directory = dirname(dirname(fileURLToPath(import.meta.resolve("opencode-quick-quote/tui"))))
  const { tui } = Host.resolve({ directory })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  expect(await Host.load(tui)).toHaveProperty("default", quickQuote)
})

// The built-in theme extracted from the installed OpenCode 2.0.28 CLI.
// Resolve it with the real theme package: a fabricated context hid invalid tokens.
const document = parseThemeDocument(JSON.parse(readFileSync(new URL("./fixtures/opencode-2.0.28.json", import.meta.url), "utf8")))
const themes = { light: resolveThemeDocument(document, "light"), dark: resolveThemeDocument(document, "dark") }

async function harness(options: { theme?: keyof typeof themes; width?: number; top?: number; reply?: string; transcript?: boolean; transparentBase?: boolean } = {}) {
  const resolved = themes[options.theme ?? "dark"]
  const theme = {
    base: resolved.background.base, surface: resolved.background.raised.base,
    text: resolved.text.base, border: resolved.border.base,
    selected: resolved.background.action.primary.focused, selectedText: resolved.text.action.primary.focused,
  }
  const width = options.width ?? 80
  const view = await createTestRenderer({ width, height: 24 })
  cleanup.push(() => view.renderer.destroy())
  const background = new BoxRenderable(view.renderer, { width: "100%", height: "100%", position: "absolute", backgroundColor: theme.base })
  view.renderer.root.add(background)
  const transcript = new TextRenderable(view.renderer, {
    width: "100%", height: options.top ?? 15, position: "absolute", fg: theme.border,
    content: Array.from({ length: options.top ?? 15 }, (_, index) => `Transcript ${index}: footer metadata`).join("\n"),
  })
  if (options.transcript) background.add(transcript)
  const container = new BoxRenderable(view.renderer, { top: options.top ?? 15, position: "absolute", width, backgroundColor: theme.base })
  const input = new TextareaRenderable(view.renderer, { width: "100%", height: 3, backgroundColor: theme.base, textColor: theme.text })
  const footer = new BoxRenderable(view.renderer, { width: "100%", height: 1 })
  container.add(input)
  container.add(footer)
  view.renderer.root.add(container)
  input.focus()
  let registered: KeymapLayer | undefined
  let slot!: SlotClaim<"prompt.footer">
  let dispose!: () => void
  const prompt: { sessionID: string; mode: "normal" | "shell"; showDetails: boolean } = {
    sessionID: "session", mode: "normal", showDetails: true,
  }
  let sessionID = "session"
  let mode = "base"
  let activeTheme = options.transparentBase ? { ...resolved, background: { ...resolved.background, base: RGBA.fromInts(0, 0, 0, 0) } } : resolved
  const ctx = {
    renderer: view.renderer,
    get theme() { return activeTheme },
    keymap: {
      // Like OpenTUI's useBindings, resolve the target in a Solid effect. A
      // non-reactive target discovered after mount never registers the layer.
      layer: (get: () => KeymapLayer) => createEffect(() => {
        const layer = get()
        registered = layer.target?.() ? layer : undefined
      }),
      mode: { current: () => mode },
    },
    data: { session: { message: { list: () => [
      { type: "assistant", content: [{ type: "text", text: "An older response." }] },
      { type: "user", text: "A user paragraph." },
      { type: "assistant", content: [
        { type: "text", text: options.reply ?? "Call her on Saturday.\n\nSend her a message.\nIt might help." },
        { type: "reasoning", text: "Private reasoning." },
      ] },
      { type: "assistant", content: [{ type: "tool", text: "Tool output." }] },
      { type: "synthetic", text: "Shell finished: gh pr checks --watch" },
      { type: "assistant", content: [{ type: "text", text: "Console CI passed too." }] },
    ] } } },
    ui: {
      slot: (claim: SlotClaim<"prompt.footer">) => { slot = claim; return () => dispose() },
      router: { current: () => ({ type: "session", sessionID }) },
    },
  } as unknown as Plugin.Context
  const implementation = process.env.QUICK_QUOTE_ARTIFACT
    ? (await import(pathToFileURL(process.env.QUICK_QUOTE_ARTIFACT).href)).default as typeof quickQuote
    : quickQuote
  await implementation.setup(ctx)
  createRoot((stop) => {
    dispose = stop
    footer.add(slot.render(prompt))
  })
  cleanup.push(() => dispose())
  await view.flush()

  const run = (id: string) => {
    expect(registered).toBeDefined()
    return registered!.commands!.find((command) => command.id === `quick-quote.${id}`)!.run()
  }
  const type = async (text: string) => {
    input.insertText(text)
    await view.flush()
  }
  const popup = () => view.renderer.root.getChildren().find((child) => child.id.startsWith("quick-quote-"))!
  const visible = () => popup()?.visible
  return {
    ...view, input, prompt, run, type, visible, popup, theme, container, transcript, dispose: () => dispose(),
    switchSession: () => { sessionID = "other" },
    setMode: (value: string) => { mode = value },
    setTheme: (value: keyof typeof themes) => { activeTheme = themes[value] },
  }
}

test("filters inline without editing the draft; inserts full quotes repeatedly", async () => {
  const h = await harness()
  await h.type("My reply 🙂 漢字\n\n>sat")
  expect(h.visible()).toBe(true)
  expect(h.captureCharFrame()).toContain("Call her on Saturday.")
  expect(h.captureCharFrame()).not.toContain("Send her a message.")
  expect(h.input.plainText).toBe("My reply 🙂 漢字\n\n>sat")
  h.run("insert")
  await h.flush()
  expect(h.input.plainText).toBe("My reply 🙂 漢字\n\n> Call her on Saturday.\n")
  expect(h.visible()).toBe(false)
  await h.type("Can't do that.\n\n>message")
  h.run("insert")
  expect(h.input.plainText).toEndWith("Can't do that.\n\n> Send her a message.\n> It might help.\n")
  await h.type("\n>console")
  h.run("insert")
  expect(h.input.plainText).toEndWith("\n> Console CI passed too.\n")
})

test("arrow selection chooses a paragraph without inserting a preview", async () => {
  const h = await harness()
  await h.type(">")
  const frame = h.captureCharFrame()
  expect(frame).toContain("Call her on Saturday.")
  expect(frame).toContain("Console CI passed too.")
  expect(frame).not.toContain("An older response.")
  expect(frame).not.toContain("A user paragraph.")
  expect(frame).not.toContain("Private reasoning.")
  expect(frame).not.toContain("Tool output.")
  expect(frame).not.toContain("Shell finished")
  h.run("next")
  expect(h.input.plainText).toBe(">")
  h.run("insert")
  expect(h.input.plainText).toBe("> Send her a message.\n> It might help.\n")
})

test("no-match Enter preserves the query; Escape dismisses until the query changes", async () => {
  const h = await harness()
  await h.type(">missing")
  h.run("insert")
  expect(h.input.plainText).toBe(">missing")
  expect(h.visible()).toBe(true)
  h.run("dismiss")
  expect(h.visible()).toBe(false)
  expect(h.run("insert")).toBe(false)
  await h.type("!")
  expect(h.visible()).toBe(true)
})

test("only owns the active normal-mode prompt, never dialog editors or native completion", async () => {
  const h = await harness()
  await h.type(">sat")
  h.prompt.mode = "shell"
  expect(h.run("insert")).toBe(false)
  h.prompt.mode = "normal"
  h.setMode("autocomplete")
  expect(h.run("insert")).toBe(false)
  h.setMode("base")
  const dialog = new TextareaRenderable(h.renderer, { width: 30, height: 1 })
  h.renderer.root.add(dialog)
  dialog.focus()
  expect(h.run("insert")).toBe(false)
  expect(h.input.plainText).toBe(">sat")
  h.input.focus()
  h.switchSession()
  expect(h.run("insert")).toBe(false)
})

test("unloading removes the dropdown and editor listeners", async () => {
  const h = await harness()
  await h.type(">sat")
  const listeners = h.input.editBuffer.listenerCount("content-changed")
  h.dispose()
  expect(h.visible()).toBeUndefined()
  expect(h.input.editBuffer.listenerCount("content-changed")).toBe(listeners - 1)
})

for (const theme of ["light", "dark"] as const) {
  test(`${theme} redraws over changing transcript text and clears old selection colors`, async () => {
    const h = await harness({ theme, transcript: true })
    await h.type(">")
    h.transcript.content = "Changed transcript footer metadata\n".repeat(15)
    h.run("next")
    await h.flush()
    const popup = h.popup()
    const frame = h.captureSpans()
    const old = frame.lines[popup.y + 1].spans.find((span) => span.text.includes("Call her"))!
    const selected = frame.lines[popup.y + 2].spans.find((span) => span.text.includes("Send her"))!
    expect(old.fg.equals(h.theme.text)).toBe(true)
    expect(old.bg.equals(h.theme.surface)).toBe(true)
    expect(selected.fg.equals(h.theme.selectedText)).toBe(true)
    expect(selected.bg.equals(h.theme.selected)).toBe(true)
    expect(h.captureCharFrame().split("\n").slice(popup.y, popup.y + popup.height).join("\n")).not.toContain("metadata")
  })

  test(`${theme} popup covers transcript metadata when the base background is transparent`, async () => {
    const h = await harness({ theme, transcript: true, transparentBase: true })
    await h.type(">")
    const popup = h.popup()
    const lines = h.captureCharFrame().split("\n").slice(popup.y, popup.y + popup.height)
    expect(lines.join("\n")).toContain("Send her a message. It might help.")
    for (const line of lines) {
      expect(line).not.toContain("metadata")
      expect(line).not.toContain("Transcript")
    }
    const normal = h.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("Send her"))!
    expect(normal).toBeDefined()
    expect(normal.bg.equals(h.theme.surface)).toBe(true)
  })

  test(`${theme} popup has an opaque overlay surface and a complete boundary above the prompt`, async () => {
    const h = await harness({ theme, transcript: true })
    await h.type(">")
    const popup = h.popup()
    const lines = h.captureCharFrame().split("\n")
    expect(popup.y + popup.height).toBe(h.container.y)
    expect(popup.height).toBe(5) // Three rows plus top and bottom borders.
    expect(lines[popup.y]).toMatch(/^┌─+┐$/)
    expect(lines[popup.y + popup.height - 1]).toMatch(/^└─+┘$/)
    const frame = h.captureSpans()
    for (let y = popup.y; y < popup.y + popup.height; y++) {
      expect(lines[y]).not.toContain("Transcript")
      expect(lines[y]).not.toContain("metadata")
      for (const span of frame.lines[y].spans) {
        expect(span.bg.a).toBe(1)
        expect([h.theme.surface, h.theme.selected].some((color) => span.bg.equals(color))).toBe(true)
      }
    }
    const selected = frame.lines[popup.y + 1].spans.find((span) => span.text.includes("Call her"))!
    expect(selected.bg.equals(h.theme.selected)).toBe(true)
    expect(selected.fg.equals(h.theme.selectedText)).toBe(true)
    const normal = frame.lines[popup.y + 2].spans.find((span) => span.text.includes("Send her"))!
    expect(normal.bg.equals(h.theme.surface)).toBe(true)
    expect(normal.fg.equals(h.theme.text)).toBe(true)
    h.run("next")
    h.run("insert")
    expect(h.input.plainText).toBe("> Send her a message.\n> It might help.\n")
  })

  test(`${theme} popup truncates one-line rows and scrolls within the available height`, async () => {
    const reply = Array.from({ length: 12 }, (_, index) => `Paragraph ${index}: ${"a long quote ".repeat(12)}`).join("\n\n")
    const h = await harness({ theme, width: 32, top: 5, reply, transcript: true })
    await h.type(">Paragraph")
    expect(h.popup().height).toBe(5)
    expect(h.popup().y).toBe(0)
    const rows = h.captureCharFrame().split("\n").slice(1, 4)
    for (const row of rows) {
      expect(row).toHaveLength(32)
      expect(row).toMatch(/^│ .*\.\.\..* │$/)
    }
    for (let index = 0; index < 11; index++) h.run("next")
    await h.flush()
    expect(h.captureCharFrame()).toContain("Paragraph 11")
    expect(h.popup().y + h.popup().height).toBe(h.container.y)
    h.run("insert")
    expect(h.input.plainText).toBe(`> Paragraph 11: ${"a long quote ".repeat(12).trimEnd()}\n`)
  })

  test(`${theme} single-result and empty popups stay compact`, async () => {
    const h = await harness({ theme })
    await h.type(">Saturday")
    expect(h.popup().height).toBe(3)
    h.input.setText(">missing")
    h.input.gotoLineEnd()
    await h.flush()
    expect(h.popup().height).toBe(3)
    expect(h.captureCharFrame()).toContain("No matching paragraphs")
    h.run("insert")
    expect(h.input.plainText).toBe(">missing")
  })
}

test("repaints an open popup when switching between real light and dark themes", async () => {
  const h = await harness({ theme: "light", transcript: true })
  await h.type(">")
  for (const theme of ["dark", "light"] as const) {
    h.setTheme(theme)
    // Use the plugin's existing layout/focus poll, not a forced invalidation.
    await new Promise((resolve) => setTimeout(resolve, 60))
    await h.flush()
    const normal = h.captureSpans().lines[h.popup().y + 2].spans.find((span) => span.text.includes("Send her"))!
    expect(normal.fg.equals(themes[theme].text.base)).toBe(true)
    expect(normal.bg.equals(themes[theme].background.raised.base)).toBe(true)
  }
})

test.skipIf(!process.env.QUICK_QUOTE_VERIFY)("records native renderer evidence", async () => {
  const directory = process.env.QUICK_QUOTE_VERIFY!
  mkdirSync(directory, { recursive: true })
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  for (const theme of ["light", "dark"] as const) {
    const h = await harness({ theme, transcript: true })
    const capture = (step: string) => {
      const frame = h.captureSpans()
      const shapes = frame.lines.flatMap((line, y) => {
        let x = 0
        return line.spans.map((span) => {
          const width = span.width * 10
          const rgb = (color: RGBA) => `rgb(${color.toInts().slice(0, 3).join(",")})`
          const result = `<rect x="${x}" y="${y * 20}" width="${width}" height="20" fill="${rgb(span.bg)}"/><text x="${x}" y="${y * 20 + 15}" fill="${rgb(span.fg)}" textLength="${width}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escape(span.text)}</text>`
          x += width
          return result
        })
      }).join("")
      const name = `${directory}/${theme}-${step}`
      writeFileSync(`${name}.txt`, h.captureCharFrame())
      const inspect = (node: Renderable): object => ({
        type: node.constructor.name, id: node.id, visible: node.visible,
        background: node instanceof BoxRenderable ? node.backgroundColor.toInts() : undefined,
        foreground: node instanceof TextRenderable ? node.fg.toInts() : undefined,
        children: node.getChildren().map(inspect),
      })
      writeFileSync(`${name}.json`, JSON.stringify({
        ...frame,
        lines: frame.lines.map((line) => ({ spans: line.spans.map((span) => ({ ...span, fg: span.fg.toInts(), bg: span.bg.toInts() })) })),
        popup: h.popup() ? inspect(h.popup()) : undefined,
      }, null, 2))
      writeFileSync(`${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><g font-family="Menlo,monospace" font-size="16">${shapes}</g></svg>`)
    }
    capture("01-before-type")
    await h.type(">")
    capture("02-before-next")
    h.run("next")
    await h.flush()
    capture("03-before-transcript-update")
    h.transcript.content = "Changed transcript footer metadata\n".repeat(15)
    await h.flush()
    capture("04-before-insert")
    h.run("insert")
    await h.flush()
    capture("05-inserted")
  }
})

test("hides the popup when there is no room for a result and both borders", async () => {
  const h = await harness({ top: 2 })
  await h.type(">Saturday")
  expect(h.visible()).toBe(false)
  expect(h.input.plainText).toBe(">Saturday")
})

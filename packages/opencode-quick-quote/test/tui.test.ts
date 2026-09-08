import { afterEach, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapLayer, SlotClaim } from "@opencode/plugin/tui/context"
import quickQuote from "../plugin/src/tui.js"

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

async function harness() {
  const view = await createTestRenderer({ width: 80, height: 24 })
  cleanup.push(() => view.renderer.destroy())
  const container = new BoxRenderable(view.renderer, { top: 15, position: "absolute", width: 80 })
  const input = new TextareaRenderable(view.renderer, { width: "100%", height: 3 })
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
  const action = { primary: { focused: "#ffffff" } }
  const ctx = {
    renderer: view.renderer,
    theme: {
      border: { default: "#777777" },
      background: { default: "#000000", action },
      text: { default: "#ffffff", subdued: "#aaaaaa", action },
    },
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
        { type: "text", text: "Call her on Saturday.\n\nSend her a message.\nIt might help." },
        { type: "reasoning", text: "Private reasoning." },
      ] },
      { type: "assistant", content: [{ type: "tool", text: "Tool output." }] },
    ] } } },
    ui: {
      slot: (claim: SlotClaim<"prompt.footer">) => { slot = claim; return () => dispose() },
      router: { current: () => ({ type: "session", sessionID }) },
    },
  } as unknown as Plugin.Context
  await quickQuote.setup(ctx)
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
  const visible = () => view.renderer.root.getChildren().find((child) => child.id.startsWith("quick-quote-"))?.visible
  return {
    ...view, input, prompt, run, type, visible, dispose: () => dispose(),
    switchSession: () => { sessionID = "other" },
    setMode: (value: string) => { mode = value },
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
})

test("arrow selection chooses a paragraph without inserting a preview", async () => {
  const h = await harness()
  await h.type(">")
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

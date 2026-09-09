import type { Plugin } from "@opencode/plugin/tui"
import {
  BoxRenderable, InputRenderable, ScrollBoxRenderable, TextRenderable, TextNodeRenderable,
  createClipboard, createHostClipboard, createRendererClipboardAdapter,
} from "@opentui/core"
import { onCleanup, onMount } from "solid-js"
import fuzzysort from "fuzzysort"

export function selectLink(ctx: Plugin.Context, links: readonly { url: string }[]) {
  return new Promise<string | undefined>((resolve) => {
    ctx.ui.dialog.set({ size: "large" })
    ctx.ui.dialog.show(() => {
      const theme = ctx.theme
      const root = new BoxRenderable(ctx.renderer, { paddingX: 2, paddingBottom: 1, gap: 1 })
      const heading = new BoxRenderable(ctx.renderer, { flexDirection: "row", justifyContent: "space-between" })
      heading.add(new TextRenderable(ctx.renderer, { content: "Quick Links", fg: theme.text.default }))
      heading.add(new TextRenderable(ctx.renderer, { content: "esc", fg: theme.text.subdued, onMouseUp: () => finish() }))
      root.add(heading)
      const input = new InputRenderable(ctx.renderer, {
        id: "quick-links-search", width: "100%", placeholder: "Search links in the conversation",
        textColor: theme.text.default, cursorColor: theme.text.default,
      })
      root.add(input)
      const list = new ScrollBoxRenderable(ctx.renderer, {
        height: Math.max(1, Math.min(12, ctx.renderer.height - 10)),
        scrollX: false, scrollbarOptions: { visible: false },
      })
      root.add(list)
      const footer = new BoxRenderable(ctx.renderer, {
        flexDirection: "row", justifyContent: "space-between", width: "100%",
      })
      function action(title: string, key: string, run: () => void) {
        const text = new TextRenderable(ctx.renderer, { onMouseUp: run })
        text.add(TextNodeRenderable.fromNodes([
          TextNodeRenderable.fromString(title + " ", { fg: theme.text.default }),
          TextNodeRenderable.fromString(key, { fg: theme.text.subdued }),
        ]))
        return text
      }
      footer.add(action("Copy", "ctrl+y", () => { void copy() }))
      footer.add(action("Open", "enter", openSelected))
      root.add(footer)

      const clipboard = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(ctx.renderer) })
      let matches = [...links]
      let selected = 0
      let rows: BoxRenderable[] = []

      function paint() {
        rows.forEach((row, index) => {
          row.backgroundColor = index === selected ? theme.background.action.primary.focused : undefined
        })
        list.scrollTo(Math.max(0, selected - Math.floor(list.height / 2)))
      }

      function finish(url?: string) {
        resolve(url)
        ctx.ui.dialog.clear()
      }

      function openSelected() {
        const link = matches[selected]
        if (link) finish(link.url)
      }

      async function copy() {
        const link = matches[selected]
        if (!link) return
        try {
          const result = await clipboard.writeText(link.url, { destination: "all-available", selection: "clipboard" })
          if (result.host.status !== "written" && result.terminal.status !== "attempted") throw new Error("Copy failed")
          ctx.ui.toast.show({ variant: "success", message: "Link copied" })
        } catch {
          ctx.ui.toast.show({ variant: "error", message: "Could not copy link" })
        }
      }

      function refresh() {
        for (const child of list.getChildren()) {
          list.remove(child)
          child.destroyRecursively()
        }
        rows = []
        matches = input.value ? fuzzysort.go(input.value, links, { key: "url" }).map((result) => result.obj) : [...links]
        selected = 0
        for (const [index, link] of matches.entries()) {
          const url = new URL(link.url)
          const row = new BoxRenderable(ctx.renderer, {
            height: 1, width: "100%",
            onMouseOver: () => { selected = index; paint() },
            onMouseUp: () => finish(link.url),
          })
          const text = new TextRenderable(ctx.renderer, { wrapMode: "none", width: "100%" })
          text.add(TextNodeRenderable.fromNodes([
            TextNodeRenderable.fromString(url.host, { fg: theme.text.default }),
            TextNodeRenderable.fromString(url.pathname + url.search + url.hash, { fg: theme.text.subdued }),
          ]))
          row.add(text)
          list.add(row)
          rows.push(row)
        }
        if (!matches.length) list.add(new TextRenderable(ctx.renderer, { content: "No matching links", fg: theme.text.subdued }))
        paint()
      }

      function move(delta: number) {
        if (!matches.length) return
        selected = (selected + delta + matches.length) % matches.length
        paint()
      }

      ctx.keymap.layer(() => ({
        mode: "global", target: () => input, priority: 1000,
        commands: [
          { bind: "up", run: () => move(-1) },
          { bind: "down", run: () => move(1) },
          { bind: "return", run: (_value, event) => {
            event?.preventDefault()
            event?.stopPropagation()
            openSelected()
          } },
          { bind: "ctrl+y", run: async (_value, event) => {
            event?.preventDefault()
            event?.stopPropagation()
            await copy()
          } },
        ],
      }))
      input.on("input", refresh)
      refresh()
      onMount(() => input.focus())
      onCleanup(() => {
        input.off("input", refresh)
        void clipboard.dispose()
      })
      return root
    }, () => resolve(undefined))
  })
}

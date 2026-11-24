import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import {
  Command,
  createKeyed,
  Panel,
  Plugin,
  Style,
  usePlugin,
  type MountedSession,
  type PanelTab,
  type SessionRef,
  type SessionScreen,
} from "@opencode/plugin/gui"
import type { Block, Deck, Decision, Option } from "./deck.js"
import * as run from "./run.js"
import type { Side, State } from "./run.js"
import { answerText } from "./format.js"
import { Settle, type Entry, type Opened } from "./rpc.js"
import css from "./gui.css?inline"

const TAB = "deck-"

const definition = Plugin.define({
  i18n: {
    en: {
      title: "Settle",
      "command.open": "Settle open questions",
      "command.open.description": "Open this session's decks that are waiting for you",
      "toast.none": "Nothing to settle in this session",
      "notify.title": "Something to settle",
    },
  },
})

// Mockups sit on the panel's own background. The frame keeps the default colour scheme, as the iframe element does,
// so the browser leaves it transparent instead of painting a backdrop, and its text takes the app's text colour.
const frame = (html: string) => {
  const root = getComputedStyle(document.documentElement)
  const text = root.getPropertyValue("--v2-text-text-base").trim() || "inherit"
  const font = root.getPropertyValue("--font-family-sans").trim() || "system-ui, sans-serif"
  return `<style>html,body{margin:0;overflow:hidden;scrollbar-width:none;background:transparent;color:${text};font:13px/18px ${font};-webkit-font-smoothing:antialiased}*{box-sizing:border-box}</style>` + html
}

function markdown(deck: Deck, decision: Decision): string {
  const axis = deck.axes.find((item) => item.id === decision.axis)?.title ?? decision.axis
  const block = (item: Block) => {
    switch (item.type) {
      case "text":
        return item.text
      case "code":
        return "```" + (item.language ?? "") + "\n" + item.code + "\n```"
      case "image":
        return `![${item.alt}](${item.src})`
      case "html":
        return "```html\n" + item.html + "\n```"
    }
  }
  return [
    `## ${decision.question}`,
    `Axis: ${axis}`,
    decision.context,
    ...decision.options.map((option) => `### ${option.title}\n\n${option.blocks.map(block).join("\n\n")}`),
  ]
    .filter(Boolean)
    .join("\n\n")
}

// A mockup grows to fit what it draws, so it never scrolls inside its card. The frame runs no scripts; same-origin
// only lets this panel read its height.
function Mockup(props: { html: string; height?: number }) {
  const [height, setHeight] = createSignal(props.height ?? 160)
  let observer: ResizeObserver | undefined
  const measure = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument
    if (!doc?.documentElement) return
    const fit = () => setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 24), 900))
    fit()
    observer?.disconnect()
    observer = new ResizeObserver(fit)
    observer.observe(doc.body ?? doc.documentElement)
  }
  onCleanup(() => observer?.disconnect())
  return (
    <iframe
      class="settle-html"
      sandbox="allow-same-origin"
      title="Preview"
      srcdoc={frame(props.html)}
      style={{ height: `${height()}px` }}
      onLoad={(event) => measure(event.currentTarget)}
    />
  )
}

function BlockView(props: { block: Block }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  return (
    <Switch>
      <Match when={props.block.type === "text" && props.block}>
        {(block) => <ui.Markdown text={block().text} class="settle-text" />}
      </Match>
      <Match when={props.block.type === "code" && props.block}>
        {(block) => <ui.Code content={block().code} language={block().language} class="settle-code" />}
      </Match>
      <Match when={props.block.type === "image" && props.block}>
        {(block) => (
          <img class="settle-image" src={block().src} alt={block().alt} width={block().width} height={block().height} />
        )}
      </Match>
      <Match when={props.block.type === "html" && props.block}>
        {(block) => <Mockup html={block().html} height={block().height} />}
      </Match>
    </Switch>
  )
}

function Card(props: { option: Option; kept: boolean; pressed: boolean; fresh: boolean; onChoose: () => void }) {
  // Descriptions sit under the title; code, mockups and images follow.
  const text = () => props.option.blocks.filter((block) => block.type === "text")
  const media = () => props.option.blocks.filter((block) => block.type !== "text")
  return (
    <article
      class="settle-card"
      role="button"
      aria-label={`Choose ${props.option.title}`}
      data-kept={props.kept || props.pressed || undefined}
      data-fresh={props.fresh || undefined}
      onClick={props.onChoose}
    >
      <h3 class="settle-card-title">{props.option.title}</h3>
      <Show when={text().length > 0}>
        <div class="settle-card-text">
          <For each={text()}>{(block) => <BlockView block={block} />}</For>
        </div>
      </Show>
      <Show when={media().length > 0}>
        <div class="settle-blocks">
          <For each={media()}>{(block) => <BlockView block={block} />}</For>
        </div>
      </Show>
    </article>
  )
}

// Animates its own height to its content's, so a new card of another height slides the rest instead of jumping.
function Grow(props: { children: JSX.Element }) {
  let inner!: HTMLDivElement
  const [height, setHeight] = createSignal<number>()
  const [ready, setReady] = createSignal(false)
  const observer = new ResizeObserver(() => setHeight(inner.offsetHeight))
  queueMicrotask(() => {
    observer.observe(inner)
    setHeight(inner.offsetHeight)
    requestAnimationFrame(() => setReady(true))
  })
  onCleanup(() => observer.disconnect())
  return (
    <div class="settle-grow" data-ready={ready() || undefined} style={{ height: height() ? `${height()}px` : undefined }}>
      <div ref={inner}>{props.children}</div>
    </div>
  )
}

function Key(props: { label: string; shortcut: string }) {
  return (
    <span class="settle-action">
      {props.label}
      <kbd class="settle-kbd" aria-hidden="true">
        {props.shortcut}
      </kbd>
    </span>
  )
}

function DeckView(props: { deckID: string; session: MountedSession; screen: SessionScreen; onDone: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const location = () => ({ location: { directory: props.session.directory } })
  const api = () => ctx.client.rpc(Settle)

  const [entry, { mutate }] = createResource(
    () => props.deckID,
    async (deckID) => (await api().get({ deckID }, location())) as Entry,
  )
  const [state, setState] = createSignal<State>()
  const [history, setHistory] = createSignal<State[]>([])
  // After a pick: the card you kept marks itself for a moment, and the option that replaced the other card fades in.
  const [kept, setKept] = createSignal<string>()
  const [fresh, setFresh] = createSignal<string>()
  let keptTimer: ReturnType<typeof setTimeout> | undefined
  // K and J work like a click: the card lights while the key is held, and the pick happens on release.
  const [pressed, setPressed] = createSignal<Side>()
  // The decision that just finished, held on screen for a moment so its pick shows before the next one comes in.
  const [leaving, setLeaving] = createSignal(false)

  const deck = () => entry()?.deck
  const current = createMemo(() => {
    const d = deck()
    const s = state() ?? (d ? entry()?.state ?? run.start(d) : undefined)
    return d && s ? { deck: d, state: s } : undefined
  })
  const now = () => {
    const c = current()
    return c ? run.current(c.deck, c.state) : undefined
  }

  const commit = (next: State) => {
    const c = current()
    if (!c || next === c.state) return
    setHistory([...history(), c.state].slice(-100))
    setState(next)
    void api().save({ deckID: props.deckID, state: next }, location()).catch(() => {})
  }

  const choose = (side: Side) => {
    const c = current()
    const n = now()
    if (!c || !n || leaving()) return
    const winner = n.decision.options[n.run[side]]!.id
    const next = run.pick(c.deck, c.state, side)
    const after = next.runs[n.decision.id]!
    const other = side === "left" ? "right" : "left"
    clearTimeout(keptTimer)
    setKept(winner)
    if (after.chosen === undefined) {
      setFresh(n.decision.options[after[other]]!.id)
      keptTimer = setTimeout(() => setKept(undefined), 450)
      commit(next)
      return
    }
    // The decision is done: show the pick on both cards, then move on.
    setFresh(undefined)
    setLeaving(true)
    keptTimer = setTimeout(() => {
      setLeaving(false)
      setKept(undefined)
      commit(next)
    }, 220)
  }
  const snooze = () => {
    const c = current()
    if (!c) return
    const next = run.snooze(c.state)
    if (next !== c.state) commit(next)
  }
  const undo = () => {
    const previous = history().at(-1)
    if (!previous) return
    setHistory(history().slice(0, -1))
    setState(previous)
    void api().save({ deckID: props.deckID, state: previous }, location()).catch(() => {})
  }
  const copy = () => {
    const c = current()
    const n = now()
    if (!c || !n) return
    void ctx.system.copy(markdown(c.deck, n.decision))
    ctx.toast.show({ title: "Copied", variant: "success", duration: 1500 })
  }

  const commentID = () => `settle-${props.deckID}`

  // Once every decision is made, the answers go into the composer as an attachment, like a comment or an image.
  // The person can add a line of their own and sends it with the rest of their message.
  const attach = (state: State) => {
    const c = current()
    if (!c) return
    const result = run.result(c.deck, state)
    const composer = props.screen.composer
    composer.detach(commentID())
    composer.attach({
      type: "note",
      origin: ctx.id,
      commentID: commentID(),
      label: c.deck.title,
      title: c.deck.title,
      subtitle: `${result.outcomes.length} decisions`,
      icon: "checklist",
      subject: answerText(c.deck, props.deckID, result),
      comment: "",
    })
    composer.focus()
    props.onDone()
    void api().finish({ deckID: props.deckID, state }, location()).catch(() => {})
    mutate({ ...entry()!, state, status: "sent", sent: Date.now() })
  }

  // A deck that was already finished when its tab opened (a restored tab, an old deck) closes its tab.
  createEffect(
    on(
      () => entry(),
      (loaded) => {
        if (loaded && (loaded.status === "sent" || loaded.state?.queue.length === 0)) props.onDone()
      },
      { defer: false },
    ),
  )

  createEffect(
    on(
      () => current(),
      (c, previous) => {
        if (!c || !previous || entry()?.status === "sent") return
        if (!run.current(c.deck, c.state) && run.current(previous.deck, previous.state)) attach(c.state)
      },
    ),
  )

  const reopen = () => {
    props.screen.composer.detach(commentID())
    mutate({ ...entry()!, status: "open" })
    undo()
  }

  const pickKey = (event: KeyboardEvent): Side | undefined => {
    const key = event.key.toLowerCase()
    return key === "k" ? "left" : key === "j" ? "right" : undefined
  }

  const ignore = (event: KeyboardEvent) =>
    !!(event.target as HTMLElement).closest("input, textarea, [contenteditable]") ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey

  const onKeyDown = (event: KeyboardEvent) => {
    if (ignore(event)) return
    const decided = !now()
    const side = decided ? undefined : pickKey(event)
    if (side) {
      event.preventDefault()
      // Holding the key keeps the card lit; repeats don't pick again.
      if (!event.repeat && !leaving()) setPressed(side)
      return
    }
    if (event.repeat) return
    const actions: Record<string, () => void> = decided ? { u: reopen } : { s: snooze, u: undo, c: copy }
    const action = actions[event.key.toLowerCase()]
    if (!action) return
    event.preventDefault()
    action()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    const side = pickKey(event)
    if (!side || pressed() !== side) return
    event.preventDefault()
    setPressed(undefined)
    choose(side)
  }

  // Losing focus mid-press cancels it, as dragging off a button does.
  const onBlur = () => setPressed(undefined)

  return (
    <div class="settle" tabindex="0" onKeyDown={onKeyDown} onKeyUp={onKeyUp} onFocusOut={onBlur}>
      <Show when={entry.error}>
        <p class="settle-error">Couldn't load this deck. {String(entry.error?.message ?? entry.error)}</p>
      </Show>
      <Show when={current()} fallback={<Show when={!entry.error}><ui.Loader size="large" /></Show>}>
        {(c) => (
          <>
            <Show when={now()} fallback={<Done count={run.result(c().deck, c().state).outcomes.length} />}>
              {(n) => {
                const total = () => c().deck.decisions.length
                const position = () => run.handled(c().deck, c().state) + 1
                const steps = () => run.steps(c().deck, c().state)
                const skipping = () => run.skips(c().state)
                return (
                  <section class="settle-decide">
                    <div class="settle-bar" aria-hidden="true">
                      <span style={{ width: `${steps().total === 0 ? 0 : (steps().done / steps().total) * 100}%` }} />
                    </div>
                    <header class="settle-ask">
                      <div class="settle-question-row">
                        <h2 class="settle-question">{n().decision.question}</h2>
                        <span class="settle-position" aria-label={`Decision ${position()} of ${total()}`}>
                          {position()}/{total()}
                        </span>
                      </div>
                      <Show when={n().decision.context}>
                        {(text) => <ui.Markdown text={text()} class="settle-context" />}
                      </Show>
                    </header>
                    <Grow>
                    <div class="settle-pair" data-leaving={leaving() || undefined}>
                      <Show when={n().decision.options[n().run.left]!} keyed>
                        {(option) => (
                          <Card
                            option={option}
                            kept={kept() === option.id}
                            pressed={pressed() === "left"}
                            fresh={fresh() === option.id}
                            onChoose={() => choose("left")}
                          />
                        )}
                      </Show>
                      <Show when={n().decision.options[n().run.right]!} keyed>
                        {(option) => (
                          <Card
                            option={option}
                            kept={kept() === option.id}
                            pressed={pressed() === "right"}
                            fresh={fresh() === option.id}
                            onChoose={() => choose("right")}
                          />
                        )}
                      </Show>
                    </div>
                    </Grow>
                    <footer class="settle-actions">
                      <ui.Button variant="ghost-muted" size="small" onClick={() => choose("left")}>
                        <Key label="Top" shortcut="K" />
                      </ui.Button>
                      <ui.Button variant="ghost-muted" size="small" onClick={() => choose("right")}>
                        <Key label="Bottom" shortcut="J" />
                      </ui.Button>
                      <span class="settle-spacer" />
                      <ui.Button
                        variant="ghost-muted"
                        size="small"
                        onClick={snooze}
                        disabled={!skipping() && c().state.queue.length < 2}
                      >
                        <Key label={skipping() ? "Skip" : "Snooze"} shortcut="S" />
                      </ui.Button>
                      <ui.Button variant="ghost-muted" size="small" onClick={undo} disabled={history().length === 0}>
                        <Key label="Undo" shortcut="U" />
                      </ui.Button>
                      <ui.Button variant="ghost-muted" size="small" onClick={copy}>
                        <Key label="Copy" shortcut="C" />
                      </ui.Button>
                    </footer>
                  </section>
                )
              }}
            </Show>
          </>
        )}
      </Show>
    </div>
  )

  function Done(props: { count: number }) {
    return (
      <section class="settle-done">
        <ui.Icon name="circle-check" />
        <p class="settle-done-title">{props.count} decisions attached to your message</p>
        <p class="settle-lede">Add anything else in the composer, then send it.</p>
        <ui.Button variant="ghost-muted" size="small" onClick={reopen}>
          <Key label="Change last pick" shortcut="U" />
        </ui.Button>
      </section>
    )
  }
}

export default Plugin.define({
  ...definition,
  setup(ctx) {
    ctx.add(Style, css)

    const titles = new Map<string, string>()
    const tabs = new Map<string, PanelTab>()
    const tabFor = (id: string): PanelTab => {
      let tab = tabs.get(id)
      if (!tab) {
        tab = {
          id,
          get title() {
            return titles.get(id.slice(TAB.length)) ?? ctx.t("title")
          },
          closable: "hover",
          label: () => (
            <span class="settle-tab">
              <ctx.ui.Icon name="checklist" size="small" />
              <span class="settle-tab-title">{titles.get(id.slice(TAB.length)) ?? ctx.t("title")}</span>
            </span>
          ),
        }
        tabs.set(id, tab)
      }
      return tab
    }

    ctx.add(Panel, {
      id: "deck",
      region: "side",
      width: 624,
      list: (input) => input.open.filter((id) => id.startsWith(TAB)).map(tabFor),
      render: (props) => (
        <Show when={props.tab.id.slice(TAB.length)} keyed>
          {(deckID) => (
            <DeckView
              deckID={deckID}
              session={props.session}
              screen={props.screen}
              onDone={() => ctx.layout.close(`${ctx.id}:${TAB}${deckID}`, props.session)}
            />
          )}
        </Show>
      ),
      enter: () => document.querySelector<HTMLElement>(".settle")?.focus(),
    })

    const open = (session: SessionRef, deckID: string, title?: string) => {
      if (title) titles.set(deckID, title)
      ctx.layout.open(`${ctx.id}:${TAB}${deckID}`, session, { tab: "select", background: true })
    }

    createKeyed(
      () => ctx.servers.get("sidecar")?.client,
      (client) => {
        onCleanup(
          client.rpc(Settle).events.on("opened", (event) => {
            const data = event.data as Opened
            const session = ctx.sessions.list().find((item) => item.id === data.sessionID && item.server.id === "sidecar")
            if (session) open(session, data.deckID, data.title)
            void ctx.attention.notify({ title: ctx.t("notify.title"), message: data.title })
          }),
        )
      },
    )

    ctx.add(Command, () => ({
      id: "open",
      title: ctx.t("command.open"),
      description: ctx.t("command.open.description"),
      keywords: "decide choose decisions deck",
      slash: { name: "settle" },
      enabled: !!ctx.sessions.current(),
      run: async () => {
        const session = ctx.sessions.current()
        if (!session) return
        const { decks } = (await ctx.client
          .rpc(Settle)
          .list({ sessionID: session.id }, { location: { directory: session.directory } })) as {
          decks: { id: string; title: string; status: string }[]
        }
        const waiting = decks.filter((deck) => deck.status !== "sent")
        if (waiting.length === 0) {
          ctx.toast.show({ title: ctx.t("toast.none") })
          return
        }
        for (const deck of waiting) open(session, deck.id, deck.title)
      },
    }))
  },
})

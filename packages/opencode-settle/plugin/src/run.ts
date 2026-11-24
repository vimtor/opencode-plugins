import type { Deck, Decision, Outcome, Pick, Result } from "./deck.js"

export type Side = "left" | "right"

export type Run = {
  left: number
  right: number
  next: number
  picks: Pick[]
  skips: number
  chosen?: number
  /** Discarded: passed over without an answer. */
  skipped?: boolean
}

export type State = {
  queue: string[]
  runs: Record<string, Run>
  notes: Record<string, string>
}

function fresh(): Run {
  return { left: 0, right: 1, next: 2, picks: [], skips: 0 }
}

function find(deck: Deck, id: string): Decision {
  const decision = deck.decisions.find((item) => item.id === id)
  if (!decision) throw new Error(`Unknown decision ${id}`)
  return decision
}

export function start(deck: Deck): State {
  return {
    queue: deck.decisions.map((decision) => decision.id),
    runs: Object.fromEntries(deck.decisions.map((decision) => [decision.id, fresh()])),
    notes: {},
  }
}

export function current(deck: Deck, state: State): { decision: Decision; run: Run } | undefined {
  const id = state.queue[0]
  if (!id) return undefined
  return { decision: find(deck, id), run: state.runs[id]! }
}

// The option you keep stays on its side and the next one takes the other side,
// so a decision with n options takes n - 1 picks.
export function pick(deck: Deck, state: State, side: Side): State {
  const now = current(deck, state)
  if (!now) return state
  const { decision, run } = now
  const winner = run[side]
  const picks = [
    ...run.picks,
    {
      left: decision.options[run.left]!.id,
      right: decision.options[run.right]!.id,
      chosen: decision.options[winner]!.id,
    },
  ]
  if (run.next >= decision.options.length) {
    return {
      ...state,
      queue: state.queue.slice(1),
      runs: { ...state.runs, [decision.id]: { ...run, picks, chosen: winner } },
    }
  }
  const loser: Side = side === "left" ? "right" : "left"
  return {
    ...state,
    runs: { ...state.runs, [decision.id]: { ...run, [loser]: run.next, next: run.next + 1, picks } },
  }
}

/** Moves the current decision to the end of the queue. */
export function snooze(state: State): State {
  const [id, ...rest] = state.queue
  if (!id || rest.length === 0) return state
  const run = state.runs[id]!
  return { ...state, queue: [...rest, id], runs: { ...state.runs, [id]: { ...run, skips: run.skips + 1 } } }
}

/** Drops the current decision without an answer. */
export function discard(state: State): State {
  const [id, ...rest] = state.queue
  if (!id) return state
  return { ...state, queue: rest, runs: { ...state.runs, [id]: { ...state.runs[id]!, skipped: true } } }
}

export function reopen(state: State, id: string): State {
  return {
    ...state,
    queue: [id, ...state.queue.filter((item) => item !== id)],
    runs: { ...state.runs, [id]: fresh() },
  }
}

export function note(state: State, id: string, text: string): State {
  return { ...state, notes: { ...state.notes, [id]: text } }
}

/** Picks made out of picks needed, so progress moves with every pick. A discarded decision counts as done. */
export function steps(deck: Deck, state: State): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const decision of deck.decisions) {
    const needed = decision.options.length - 1
    const run = state.runs[decision.id]
    total += needed
    done += run?.skipped || run?.chosen !== undefined ? needed : Math.min(run?.picks.length ?? 0, needed)
  }
  return { done, total }
}

/** Decisions picked or discarded. */
export function handled(deck: Deck, state: State): number {
  return deck.decisions.filter((decision) => {
    const run = state.runs[decision.id]
    return run?.skipped || run?.chosen !== undefined
  }).length
}

export function picksLeft(decision: Decision, run: Run): number {
  return decision.options.length - 1 - run.picks.length
}

export function progress(deck: Deck, state: State) {
  return deck.axes.map((axis) => {
    const decisions = deck.decisions.filter((decision) => decision.axis === axis.id)
    return {
      axis,
      total: decisions.length,
      decided: decisions.filter((decision) => state.runs[decision.id]?.chosen !== undefined).length,
    }
  })
}

export function result(deck: Deck, state: State, decidedAt = new Date()): Result {
  const outcomes = deck.decisions.flatMap((decision): Outcome[] => {
    const run = state.runs[decision.id]
    if (run?.chosen === undefined) return []
    const chosen = decision.options[run.chosen]!
    const text = state.notes[decision.id]?.trim()
    return [
      {
        decision: decision.id,
        axis: decision.axis,
        question: decision.question,
        chosen: { id: chosen.id, title: chosen.title, ...(chosen.tag ? { tag: chosen.tag } : {}) },
        rejected: decision.options
          .filter((option) => option.id !== chosen.id)
          .map((option) => ({ id: option.id, title: option.title })),
        picks: run.picks,
        skips: run.skips,
        ...(text ? { note: text } : {}),
      },
    ]
  })
  return { deck: deck.id, title: deck.title, decidedAt: decidedAt.toISOString(), outcomes }
}

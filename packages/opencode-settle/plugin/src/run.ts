import type { Deck, Decision, Outcome, Pick, Result } from "./deck.js"

export type Side = "left" | "right"

export type Run = {
  left: number
  right: number
  next: number
  picks: Pick[]
  skips: number
  chosen?: number
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

export function skip(state: State): State {
  const [id, ...rest] = state.queue
  if (!id || rest.length === 0) return state
  const run = state.runs[id]!
  return { ...state, queue: [...rest, id], runs: { ...state.runs, [id]: { ...run, skips: run.skips + 1 } } }
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
        chosen: { id: chosen.id, title: chosen.title },
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

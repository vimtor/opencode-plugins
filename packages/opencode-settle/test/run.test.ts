import { describe, expect, test } from "bun:test"
import { parseDeck } from "opencode-settle/deck"
import * as run from "opencode-settle/run"

const deck = parseDeck({
  id: "test",
  title: "Test",
  axes: [{ id: "look", title: "Look" }],
  decisions: [
    { id: "three", axis: "look", question: "Three?", options: ["a", "b", "c"].map((id) => ({ id, title: id.toUpperCase() })) },
    { id: "two", axis: "look", question: "Two?", options: ["x", "y"].map((id) => ({ id, title: id.toUpperCase() })) },
  ],
})

describe("run", () => {
  test("keeps the chosen option on its side and brings in the next one", () => {
    let state = run.start(deck)
    state = run.pick(deck, state, "right")
    expect(state.runs.three).toMatchObject({ left: 2, right: 1, next: 3 })
    state = run.pick(deck, state, "left")
    expect(state.runs.three!.chosen).toBe(2)
    expect(state.queue).toEqual(["two"])
  })

  test("snoozing moves the decision to the end and counts it", () => {
    const state = run.snooze(run.start(deck))
    expect(state.queue).toEqual(["two", "three"])
    expect(state.runs.three!.skips).toBe(1)
  })

  test("the last decision can't be snoozed", () => {
    const last = { ...run.start(deck), queue: ["two"] }
    expect(run.snooze(last)).toBe(last)
  })

  test("discarding drops a decision without an answer, even the last one", () => {
    let state = run.discard(run.start(deck))
    expect(state.queue).toEqual(["two"])
    expect(state.runs.three!.skipped).toBe(true)
    expect(run.handled(deck, state)).toBe(1)
    state = run.discard(state)
    expect(state.queue).toEqual([])
    expect(run.result(deck, state).outcomes).toEqual([])
  })

  test("progress moves with every pick", () => {
    let state = run.start(deck)
    expect(run.steps(deck, state)).toEqual({ done: 0, total: 3 })
    state = run.pick(deck, state, "left")
    expect(run.steps(deck, state)).toEqual({ done: 1, total: 3 })
    state = run.pick(deck, state, "left")
    expect(run.steps(deck, state)).toEqual({ done: 2, total: 3 })
  })

  test("a discarded decision counts as done", () => {
    let state = run.snooze(run.start(deck))
    state = run.pick(deck, state, "left")
    expect(run.steps(deck, state)).toEqual({ done: 1, total: 3 })
    state = run.discard(state)
    expect(state.queue).toEqual([])
    expect(run.steps(deck, state)).toEqual({ done: 3, total: 3 })
  })

  test("the result lists the chosen and passed-over options", () => {
    let state = run.start(deck)
    state = run.pick(deck, state, "left")
    state = run.pick(deck, state, "left")
    state = run.pick(deck, state, "right")
    const result = run.result(deck, state, new Date(0))
    expect(result.outcomes.map((outcome) => outcome.chosen.id)).toEqual(["a", "y"])
    expect(result.outcomes[0]!.rejected.map((option) => option.id)).toEqual(["b", "c"])
  })
})

describe("tags", () => {
  const tagged = parseDeck({
    id: "t",
    title: "T",
    axes: [{ id: "a", title: "A" }],
    decisions: [
      {
        id: "d",
        axis: "a",
        question: "?",
        options: [
          { id: "o", title: "O", tag: "Recommended" },
          { id: "p", title: "P" },
        ],
      },
    ],
  })

  test("an option keeps its tag, and the answer carries it", () => {
    expect(tagged.decisions[0]!.options[0]!.tag).toBe("Recommended")
    const state = run.pick(tagged, run.start(tagged), "left")
    expect(run.result(tagged, state).outcomes[0]!.chosen).toEqual({ id: "o", title: "O", tag: "Recommended" })
  })

  test("a tag is one short word", () => {
    const deck = (tag: string) => ({
      id: "t",
      title: "T",
      axes: [{ id: "a", title: "A" }],
      decisions: [{ id: "d", axis: "a", question: "?", options: [{ id: "o", title: "O", tag }, { id: "p", title: "P" }] }],
    })
    expect(() => parseDeck(deck("Current behavior"))).toThrow("one word")
    expect(() => parseDeck(deck("Recommendedbutlonger"))).toThrow("one word")
  })
})

describe("parseDeck", () => {
  test("rejects a decision with one option", () => {
    expect(() =>
      parseDeck({
        id: "x",
        title: "X",
        axes: [{ id: "a", title: "A" }],
        decisions: [{ id: "d", axis: "a", question: "?", options: [{ id: "o", title: "O" }] }],
      }),
    ).toThrow("decisions[0].options: needs at least 2")
  })

  test("rejects an unknown axis", () => {
    expect(() =>
      parseDeck({
        id: "x",
        title: "X",
        axes: [{ id: "a", title: "A" }],
        decisions: [
          {
            id: "d",
            axis: "b",
            question: "?",
            options: [
              { id: "o", title: "O" },
              { id: "p", title: "P" },
            ],
          },
        ],
      }),
    ).toThrow("isn't in axes")
  })
})

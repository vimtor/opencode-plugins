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
    const state = run.skip(run.start(deck))
    expect(state.queue).toEqual(["two", "three"])
    expect(state.runs.three!.skips).toBe(1)
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

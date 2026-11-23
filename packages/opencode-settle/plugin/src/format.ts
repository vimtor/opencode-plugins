import type { Deck, Result } from "./deck.js"

// The message the user "sends" back to the session once they've decided.
export function answerText(deck: Deck, deckID: string, result: Result): string {
  const lines = [`My answers to “${deck.title}” (${deckID}):`]
  for (const axis of deck.axes) {
    const outcomes = result.outcomes.filter((outcome) => outcome.axis === axis.id)
    if (outcomes.length === 0) continue
    lines.push("", `**${axis.title}**`)
    for (const outcome of outcomes) {
      const rejected = outcome.rejected.map((option) => option.title).join("; ")
      lines.push(`- ${outcome.question} **${outcome.chosen.title}** (\`${outcome.decision}: ${outcome.chosen.id}\`), over ${rejected}.`)
      if (outcome.note) lines.push(`  Note: ${outcome.note}`)
    }
  }
  const missing = deck.decisions.filter((decision) => !result.outcomes.some((outcome) => outcome.decision === decision.id))
  if (missing.length > 0) {
    lines.push("", `Not decided yet: ${missing.map((decision) => decision.question).join("; ")}`)
  }
  return lines.join("\n")
}

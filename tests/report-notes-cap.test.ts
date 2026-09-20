import { describe, expect, it } from 'vitest'
import { capNotesForPrompt } from '@/lib/report-stats'

// Caps the note text that reaches the LLM prompt so a few long shared notes can't balloon a draft to
// hundreds of KB (token cost / latency / timeout risk). Pure function — exhaustively unit-testable.
describe('capNotesForPrompt', () => {
  it('passes short notes through unchanged and preserves order', () => {
    expect(capNotesForPrompt(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('truncates a single note to maxPerNote', () => {
    const [out] = capNotesForPrompt(['x'.repeat(10_000)], { maxPerNote: 100, maxTotalChars: 1_000 })
    expect(out).toHaveLength(100)
  })

  it('stops adding notes once the total budget is exhausted', () => {
    const bodies = Array.from({ length: 10 }, () => 'y'.repeat(500))
    const out = capNotesForPrompt(bodies, { maxTotalChars: 1_000, maxPerNote: 500 })
    expect(out).toHaveLength(2) // 2 * 500 == 1000 budget, rest dropped
    expect(out.join('').length).toBe(1_000)
  })

  it('truncates the boundary note to the remaining budget, not maxPerNote', () => {
    const out = capNotesForPrompt(['a'.repeat(400), 'b'.repeat(400)], {
      maxTotalChars: 500,
      maxPerNote: 400,
    })
    expect(out[0]).toHaveLength(400)
    expect(out[1]).toHaveLength(100) // only 100 of the total budget left
    expect(out.join('').length).toBe(500)
  })

  it('never exceeds the total budget across many notes', () => {
    const bodies = Array.from({ length: 50 }, (_, i) => `note ${i} `.repeat(1_000))
    const total = capNotesForPrompt(bodies).join('').length
    expect(total).toBeLessThanOrEqual(20_000)
  })

  it('handles an empty list', () => {
    expect(capNotesForPrompt([])).toEqual([])
  })
})

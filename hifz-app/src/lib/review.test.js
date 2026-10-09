import { describe, expect, it } from 'vitest'
import { buildReviewEntry, getIntervalFromMistakes } from './review'

describe('review scheduler', () => {
  it('starts with a short review interval for a new weak point', () => {
    const entry = buildReviewEntry({ surahIndex: 1, mistakeCount: 1, now: Date.now() })

    expect(entry.surahIndex).toBe(1)
    expect(entry.interval).toBeGreaterThanOrEqual(1)
    expect(entry.dueAt).toBeGreaterThan(entry.createdAt)
  })

  it('increases the interval as the same word gets revisited', () => {
    const first = buildReviewEntry({ surahIndex: 3, mistakeCount: 2, now: Date.now() })
    const second = buildReviewEntry({ surahIndex: 3, mistakeCount: 5, now: Date.now() + 24 * 60 * 60 * 1000 })

    expect(first.interval).toBeLessThan(second.interval)
    expect(second.dueAt).toBeGreaterThan(first.dueAt)
  })

  it('uses a stronger spacing for repeated weak points', () => {
    expect(getIntervalFromMistakes(1)).toBe(1)
    expect(getIntervalFromMistakes(3)).toBeGreaterThanOrEqual(2)
    expect(getIntervalFromMistakes(6)).toBeGreaterThanOrEqual(4)
  })
})

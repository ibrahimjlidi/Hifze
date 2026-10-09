const DAY_IN_MS = 24 * 60 * 60 * 1000

export const getIntervalFromMistakes = (mistakeCount = 0) => {
  if (mistakeCount <= 1) return 1
  if (mistakeCount <= 2) return 2
  if (mistakeCount <= 4) return 4
  if (mistakeCount <= 7) return 7
  return 10
}

export const buildReviewEntry = ({ surahIndex = 0, mistakeCount = 1, now = Date.now() }) => {
  const interval = getIntervalFromMistakes(mistakeCount)
  const createdAt = now
  const dueAt = createdAt + interval * DAY_IN_MS

  return {
    surahIndex,
    mistakeCount,
    interval,
    createdAt,
    dueAt,
  }
}

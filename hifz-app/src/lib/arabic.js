export const SENSITIVITY_LEVELS = {
  strict: { label: 'دقيق', maxDistance: 0 },
  normal: { label: 'متوازن', maxDistance: 1 },
  forgiving: { label: 'متسامح', maxDistance: 2 },
}

export const COMMON_RECOGNITION_VARIANTS = {
  لله: ['الله'],
  بسم: ['بسم'],
  الرحمن: ['الرحمن'],
  الرحيم: ['الرحيم'],
}

export const normalizeArabic = (text = '') =>
  String(text)
    .normalize('NFKC')
    .replace(/\u0670/g, 'ا')
    .replace(/[\u064B-\u065F\u06D6-\u06ED\u0640]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئى]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[اء]/g, '')
    .replace(/[^\u0621-\u064A]/g, '')

export const levenshtein = (left, right) => {
  const matrix = Array.from({ length: right.length + 1 }, () => new Array(left.length + 1).fill(0))

  for (let i = 0; i <= left.length; i += 1) matrix[0][i] = i
  for (let j = 0; j <= right.length; j += 1) matrix[j][0] = j

  for (let j = 1; j <= right.length; j += 1) {
    for (let i = 1; i <= left.length; i += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost,
      )
    }
  }

  return matrix[right.length][left.length]
}

export const wordMatches = (expected, actual, sensitivity = 'normal') => {
  const normalizedExpected = normalizeArabic(expected)
  const normalizedActual = normalizeArabic(actual)

  if (!normalizedExpected || !normalizedActual) return false
  if (normalizedExpected === normalizedActual) return true

  const variantSet = COMMON_RECOGNITION_VARIANTS[normalizedExpected] || []
  if (variantSet.includes(normalizedActual)) return true

  const allowedDistance = SENSITIVITY_LEVELS[sensitivity]?.maxDistance ?? 1
  if (Math.min(normalizedExpected.length, normalizedActual.length) < 4) {
    return normalizedExpected === normalizedActual
  }

  return levenshtein(normalizedExpected, normalizedActual) <= allowedDistance
}

export const classifySpeech = (spokenTokens, expectedWords, sensitivity = 'normal') => {
  const issues = []
  let cursor = 0

  for (const token of spokenTokens) {
    const normalizedToken = normalizeArabic(token)
    if (!normalizedToken) continue

    if (cursor >= expectedWords.length) {
      issues.push({ type: 'extra', said: token, expected: null })
      continue
    }

    const expectedEntry = expectedWords[cursor]
    const expectedText = typeof expectedEntry === 'string' ? expectedEntry : expectedEntry.word
    const expectedNormalized = typeof expectedEntry === 'string' ? normalizeArabic(expectedText) : normalizeArabic(expectedEntry.normalized || expectedEntry.word)

    if (wordMatches(expectedText, token, sensitivity)) {
      cursor += 1
      continue
    }

    const nextEntry = expectedWords[cursor + 1]
    const nextText = nextEntry ? (typeof nextEntry === 'string' ? nextEntry : nextEntry.word) : ''
    const nextMatches = nextText && wordMatches(nextText, token, sensitivity)

    if (nextMatches) {
      issues.push({ type: 'skipped', index: cursor, expected: expectedText, said: token })
      cursor += 1
      continue
    }

    issues.push({ type: 'wrong', index: cursor, expected: expectedText, said: token })
  }

  while (cursor < expectedWords.length) {
    const expectedEntry = expectedWords[cursor]
    const expectedText = typeof expectedEntry === 'string' ? expectedEntry : expectedEntry.word
    issues.push({ type: 'skipped', index: cursor, expected: expectedText, said: null })
    cursor += 1
  }

  return {
    matched: cursor,
    issues,
  }
}

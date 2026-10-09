import { describe, expect, it } from 'vitest'
import { Q } from '../quranData'
import { classifySpeech, normalizeArabic, wordMatches } from './arabic'

describe('Arabic matching', () => {
  it('normalizes Arabic text consistently with the current app logic', () => {
    expect(normalizeArabic('بِسْمِ ٱللّٰهِ')).toBe('بسملله')
    expect(normalizeArabic('الْحَمْدُ')).toBe('لحمد')
  })

  it('matches the same words under normal recognition tolerances', () => {
    expect(wordMatches('بِسْمِ', 'بسم')).toBe(true)
    expect(wordMatches('ٱللَّهِ', 'لله')).toBe(true)
    expect(wordMatches('الرحيم', 'الرحيم')).toBe(true)
  })

  it('detects skipped tokens', () => {
    const skipped = classifySpeech(['بسم', 'الرحمن'], [
      { word: 'بِسْمِ' },
      { word: 'ٱللَّهِ' },
      { word: 'ٱلرَّحْمَٰنِ' },
    ])

    expect(skipped.issues[0]?.type).toBe('skipped')
  })

  it('detects wrong tokens', () => {
    const wrong = classifySpeech(['بسم', 'الله', 'سلام'], [
      { word: 'بِسْمِ' },
      { word: 'ٱللَّهِ' },
      { word: 'ٱلرَّحْمَٰنِ' },
    ])

    expect(wrong.issues[0]?.type).toBe('wrong')
  })

  it('keeps extra tokens separate', () => {
    const extra = classifySpeech(['بسم', 'الله', 'مرحبا'], [{ word: 'بِسْمِ' }, { word: 'ٱللَّهِ' }])
    expect(extra.issues.some((issue) => issue.type === 'extra')).toBe(true)
  })

  it('keeps the Quran data valid', () => {
    const totalVerses = Q.reduce((sum, surah) => sum + surah.v.length, 0)
    expect(Q).toHaveLength(114)
    expect(totalVerses).toBe(6236)
  })
})

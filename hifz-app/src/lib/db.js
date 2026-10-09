import Dexie from 'dexie'
import { buildReviewEntry } from './review'

export const db = new Dexie('hifz-db')

db.version(1).stores({
  mistakes: '++id, createdAt, date, surahIndex, verseIndex, wordIndex, type',
})

db.version(2).stores({
  mistakes: '++id, createdAt, date, surahIndex, verseIndex, wordIndex, type',
  reviewQueue: '++id, status, dueAt, surahIndex, createdAt',
})

export const saveMistake = async (mistake) => {
  const payload = {
    ...mistake,
    createdAt: Date.now(),
    date: new Date().toISOString().slice(0, 10),
  }

  await db.table('mistakes').add(payload)

  const reviewEntry = buildReviewEntry({
    surahIndex: Number(mistake.surahIndex ?? 0),
    mistakeCount: 1,
    now: payload.createdAt,
  })

  await db.table('reviewQueue').add({
    ...reviewEntry,
    status: 'pending',
    type: mistake.type || 'mistake',
    expected: mistake.expected || '',
    said: mistake.said || '',
    createdAt: payload.createdAt,
  })

  return payload
}

export const getMistakes = async () => db.table('mistakes').orderBy('createdAt').reverse().toArray()

export const getDueReviews = async (now = Date.now()) => {
  const rows = await db.table('reviewQueue').where('status').equals('pending').sortBy('dueAt')
  return rows.filter((row) => (row.dueAt ?? 0) <= now)
}

export const getReviewQueue = async () => db.table('reviewQueue').where('status').equals('pending').sortBy('dueAt')

export const getReviewHistory = async () => {
  const rows = await db.table('reviewQueue').where('status').equals('done').toArray()
  return rows.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
}

export const markReviewComplete = async (id) => {
  if (!id) return
  await db.table('reviewQueue').update(id, {
    status: 'done',
    completedAt: Date.now(),
  })
}

export const getReviewSummary = (rows = []) => {
  const groups = new Map()

  rows.forEach((row) => {
    const key = row.surahIndex ?? 0
    const current = groups.get(key) || { surahIndex: key, count: 0, name: `Surah ${key + 1}` }
    current.count += 1
    groups.set(key, current)
  })

  return Array.from(groups.values()).sort((a, b) => b.count - a.count)
}

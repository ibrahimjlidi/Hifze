import { useEffect, useMemo, useRef, useState } from 'react'
import { BASM, LV, PER, Q } from './quranData'
import { SENSITIVITY_LEVELS, classifySpeech, normalizeArabic, wordMatches } from './lib/arabic'
import { getDueReviews, getMistakes, getReviewHistory, getReviewSummary, markReviewComplete, saveMistake } from './lib/db'
import './App.css'

const ar = (n) => String(n)
const surahName = (index) => Q[index]?.a || `السورة ${ar(index + 1)}`
const TOTAL_MUSHAF_PAGES = 604

const rank = (s, v, i) => (((s + 1) * 73856093 ^ (v + 1) * 19349663 ^ (i + 1) * 83492791) >>> 0) % 1000 / 1000

const words = (text) => {
  const output = []
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      if (output.length && /^[\u06D6-\u06ED]+$/.test(word)) {
        output[output.length - 1] += ' ' + word
      } else {
        output.push(word)
      }
    })
  return output
}

const norm = normalizeArabic

const match = (a, b, sensitivity = 'normal') => wordMatches(a, b, sensitivity)

const head = (word, position) => {
  let output = ''
  let count = 0
  for (const ch of word) {
    if (!/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/.test(ch)) {
      if (count === position) break
      count += 1
    }
    output += ch
  }
  return output
}

const loadDoneState = () => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem('hifz2')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const loadStudyState = () => {
  if (typeof window === 'undefined') return { goal: 20, log: {} }
  try {
    const raw = window.localStorage.getItem('hifzStudy')
    return raw ? JSON.parse(raw) : { goal: 20, log: {} }
  } catch {
    return { goal: 20, log: {} }
  }
}

const loadKhatmahState = () => {
  const fallback = { started: false, bookmark: { surahIndex: 0, page: 0 }, completedPages: 0, dailyWird: 5, log: {} }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem('hifzKhatmah')
    if (!raw) return fallback
    const saved = JSON.parse(raw)
    if (!saved || typeof saved !== 'object') return fallback
    const bookmarkSurahIndex = Math.min(Q.length - 1, Math.max(0, Math.floor(Number(saved.bookmark?.surahIndex) || 0)))
    const bookmarkPageCount = Math.ceil(Q[bookmarkSurahIndex].v.length / PER)
    return {
      started: saved.started === true || Number(saved.completedPages) > 0,
      bookmark: {
        surahIndex: bookmarkSurahIndex,
        page: Math.min(bookmarkPageCount - 1, Math.max(0, Math.floor(Number(saved.bookmark?.page) || 0))),
      },
      completedPages: Math.min(TOTAL_MUSHAF_PAGES, Math.max(0, Math.floor(Number(saved.completedPages) || 0))),
      dailyWird: Math.min(TOTAL_MUSHAF_PAGES, Math.max(1, Math.floor(Number(saved.dailyWird) || 5))),
      log: saved.log && typeof saved.log === 'object' && !Array.isArray(saved.log) ? saved.log : {},
    }
  } catch {
    return fallback
  }
}

const defaultRecState = () => ({
  key: '',
  f: [],
  pos: 0,
  start: 0,
  flawed: new Set(),
  hint: '',
  hl: 0,
  mist: 0,
  msg: '',
  fin: false,
  mistakes: [],
  currentIssue: null,
  peekCount: 0,
})

function App() {
  const [khatmah, setKhatmah] = useState(loadKhatmahState)
  const [surahIndex, setSurahIndex] = useState(() => khatmah.bookmark.surahIndex)
  const [page, setPage] = useState(() => khatmah.bookmark.page)
  const [dashboardExpanded, setDashboardExpanded] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 600px)').matches)
  const [khatmahSavedMessage, setKhatmahSavedMessage] = useState('')
  const [mode, setMode] = useState('read')
  const [hiddenLevel, setHiddenLevel] = useState(0)
  const [shownWords, setShownWords] = useState({})
  const [done, setDone] = useState(loadDoneState)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [dailyGoal, setDailyGoal] = useState(() => loadStudyState().goal || 20)
  const [studyLog, setStudyLog] = useState(() => loadStudyState().log || {})
  const [pagesToLog, setPagesToLog] = useState(1)
  const [focusMinutes, setFocusMinutes] = useState(15)
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(15 * 60)
  const [focusActive, setFocusActive] = useState(false)
  const [rec, setRec] = useState(defaultRecState)
  const [listening, setListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [sensitivity, setSensitivity] = useState('normal')
  const [mistakes, setMistakes] = useState([])
  const [reviewQueue, setReviewQueue] = useState([])
  const [reviewHistory, setReviewHistory] = useState([])
  const recognitionRef = useRef(null)
  const audioRef = useRef(null)
  const pageSwipeStartRef = useRef(null)
  const todayKey = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme
    }
  }, [theme])

  useEffect(() => {
    let isMounted = true
    const loadMistakes = async () => {
      try {
        const rows = await getMistakes()
        if (isMounted) setMistakes(rows)
      } catch {
        if (isMounted) setMistakes([])
      }
    }

    const loadReviewQueue = async () => {
      try {
        const rows = await getDueReviews()
        if (isMounted) setReviewQueue(rows)
      } catch {
        if (isMounted) setReviewQueue([])
      }
    }

    const loadReviewHistory = async () => {
      try {
        const rows = await getReviewHistory()
        if (isMounted) setReviewHistory(rows)
      } catch {
        if (isMounted) setReviewHistory([])
      }
    }

    loadMistakes()
    loadReviewQueue()
    loadReviewHistory()
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const loadReviewQueue = async () => {
      try {
        const rows = await getDueReviews()
        if (isMounted) setReviewQueue(rows)
      } catch {
        if (isMounted) setReviewQueue([])
      }
    }

    const loadReviewHistory = async () => {
      try {
        const rows = await getReviewHistory()
        if (isMounted) setReviewHistory(rows)
      } catch {
        if (isMounted) setReviewHistory([])
      }
    }

    loadReviewQueue()
    loadReviewHistory()
    return () => {
      isMounted = false
    }
  }, [mistakes])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.removeAttribute('src')
        audioRef.current.load()
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hifz2', JSON.stringify(done))
    }
  }, [done])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hifzStudy', JSON.stringify({ goal: dailyGoal, log: studyLog }))
    }
  }, [dailyGoal, studyLog])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hifzKhatmah', JSON.stringify(khatmah))
    }
  }, [khatmah])

  useEffect(() => {
    if (!focusActive) return undefined

    const interval = window.setInterval(() => {
      setFocusSecondsLeft((previous) => {
        if (previous <= 1) {
          setFocusActive(false)
          return 0
        }
        return previous - 1
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [focusActive])

  const currentSurah = Q[surahIndex]
  const currentCompleted = done[surahIndex] || []
  const verseStart = page * PER
  const verseEnd = Math.min(currentSurah.v.length, (page + 1) * PER)
  const pageTotal = Math.ceil(currentSurah.v.length / PER)

  const overallProgress = useMemo(() => {
    let total = 0
    let memorized = 0
    Q.forEach((surah, index) => {
      total += surah.v.length
      memorized += (done[index] || []).length
    })
    return {
      total,
      memorized,
      percent: total ? Math.round((memorized / total) * 100) : 0,
    }
  }, [done])

  const surahProgress = useMemo(() => {
    const verses = currentSurah.v.length
    const memorized = currentCompleted.length
    return {
      verses,
      memorized,
      percent: verses ? Math.round((memorized / verses) * 100) : 0,
    }
  }, [currentCompleted.length, currentSurah.v.length])

  const revisionQueue = useMemo(() => {
    return Q.map((surah, index) => ({
      name: surah.a,
      index,
      verses: surah.v.length,
      memorized: (done[index] || []).length,
      percent: surah.v.length ? Math.round(((done[index] || []).length / surah.v.length) * 100) : 0,
    })).sort((a, b) => a.percent - b.percent).slice(0, 3)
  }, [done])

  const todayCount = studyLog[todayKey] || 0
  const khatmahTodayPages = Number(khatmah.log[todayKey]) || 0
  const khatmahRemainingPages = Math.max(0, TOTAL_MUSHAF_PAGES - khatmah.completedPages)
  const khatmahProgress = Math.round((khatmah.completedPages / TOTAL_MUSHAF_PAGES) * 100)
  const khatmahDaysRemaining = Math.ceil(khatmahRemainingPages / khatmah.dailyWird)
  const studyStreak = useMemo(() => {
    const activeDays = Object.keys(studyLog)
      .filter((key) => Number(studyLog[key] || 0) > 0)
      .sort()

    if (!activeDays.length) return 0

    let streak = 0
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)

    while (true) {
      const key = cursor.toISOString().slice(0, 10)
      if ((studyLog[key] || 0) > 0) {
        streak += 1
        cursor.setDate(cursor.getDate() - 1)
        continue
      }

      break
    }

    return streak
  }, [studyLog])

  const weeklyProgress = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (6 - index))
      const key = date.toISOString().slice(0, 10)
      const count = Number(studyLog[key] || 0)
      return {
        key,
        short: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'][date.getDay()],
        count,
        height: Math.min(100, count ? 25 + Math.min(75, count * 10) : 8),
      }
    })
  }, [studyLog])

  const goalProgress = Math.min(100, Math.round((todayCount / dailyGoal) * 100))
  const weeklyWordTotal = useMemo(() => weeklyProgress.reduce((sum, item) => sum + item.count, 0), [weeklyProgress])
  const bestStreak = useMemo(() => {
    let current = 0
    let best = 0
    const sortedDates = Object.keys(studyLog)
      .filter((key) => Number(studyLog[key] || 0) > 0)
      .sort()
      .map((key) => new Date(`${key}T00:00:00`))

    for (let index = 0; index < sortedDates.length; index += 1) {
      const currentDate = sortedDates[index]
      const previousDate = index > 0 ? sortedDates[index - 1] : null
      if (!previousDate) {
        current = 1
      } else {
        const diffDays = Math.round((currentDate - previousDate) / (1000 * 60 * 60 * 24))
        current = diffDays === 1 ? current + 1 : 1
      }
      best = Math.max(best, current)
    }

    return best || 0
  }, [studyLog])

  const reviewSummary = useMemo(() => getReviewSummary(mistakes), [mistakes])
  const dueReviews = useMemo(() => [...(reviewQueue || [])].sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0)), [reviewQueue])
  const dueReviewSummary = useMemo(() => getReviewSummary(dueReviews), [dueReviews])
  const strongestReviewTarget = dueReviewSummary[0] || reviewSummary[0]
  const focusSurahName = strongestReviewTarget ? surahName(strongestReviewTarget.surahIndex) : 'أضعف سورة'
  const reviewPriorityLabel = strongestReviewTarget ? `${focusSurahName} · ${ar(strongestReviewTarget.count)} مواضع تحتاج إلى مراجعة` : 'لم تُسجّل مواضع تحتاج إلى مراجعة بعد'
  const reviewPlan = useMemo(() => [
    { label: 'السورة', value: focusSurahName, meta: 'موضع التركيز الأضعف' },
    { label: 'مستحقة', value: ar(dueReviews.length), meta: 'جاهزة للمراجعة' },
    { label: 'مكتملة', value: ar(reviewHistory.length), meta: 'مراجعات أُنجزت اليوم' },
  ], [dueReviews.length, focusSurahName, reviewHistory.length])
  const coachMessage = useMemo(() => {
    if (dueReviews.length > 0) {
      return `راجع سورة ${surahName(dueReviews[0].surahIndex)} قبل المتابعة؛ موعد مراجعتها الآن.`
    }
    if (todayCount < dailyGoal) {
      return `بقي ${ar(Math.max(0, dailyGoal - todayCount))} كلمة لتحقيق هدف اليوم. اجعل المراجعة التالية قصيرة ومركّزة.`
    }
    if (strongestReviewTarget) {
      return `أكثر مواضع الضعف في سورة ${surahName(strongestReviewTarget.surahIndex)}. خصّص لها تلاوة قصيرة.`
    }
    return 'أحسنت، واصل بهذا الإيقاع وراجع مقطعًا قصيرًا قبل أن تنتهي.'
  }, [dailyGoal, dueReviews, strongestReviewTarget, todayCount])
  const nextDueReview = dueReviews[0]
  const reviewFocusIndex = strongestReviewTarget?.surahIndex ?? surahIndex
  const reviewFocusDetails = useMemo(() => {
    const surah = Q[reviewFocusIndex]
    if (!surah) return []

    const verseCounts = new Map()
    mistakes.forEach((item) => {
      if (Number(item.surahIndex ?? -1) !== reviewFocusIndex) return
      const verseIndex = Number(item.verseIndex ?? 0)
      verseCounts.set(verseIndex, (verseCounts.get(verseIndex) || 0) + 1)
    })

    return [...surah.v.entries()].map(([verseIndex, verseText]) => ({
      verseIndex,
      count: verseCounts.get(verseIndex) || 0,
      preview: words(verseText).slice(0, 4).join(' '),
      memoized: done[reviewFocusIndex]?.includes(verseIndex) ?? false,
    })).filter((item) => item.count > 0 || item.memoized === false).sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      return a.verseIndex - b.verseIndex
    }).slice(0, 5)
  }, [done, mistakes, reviewFocusIndex])
  const formatReviewDueLabel = (dueAt) => {
    if (!dueAt) return 'ستُجدول قريبًا'
    const diffMs = dueAt - Date.now()
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (days <= 0) return 'مستحقة الآن'
    if (days === 1) return 'مستحقة غدًا'
    return `مستحقة بعد ${ar(days)} أيام`
  }
  const formatDuration = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0)
    const minutes = Math.floor(safeSeconds / 60)
    const remainder = safeSeconds % 60
    return ar(`${minutes}:${String(remainder).padStart(2, '0')}`)
  }
  const focusProgress = focusMinutes > 0 ? Math.min(100, Math.round(((focusMinutes * 60 - focusSecondsLeft) / (focusMinutes * 60)) * 100)) : 0
  const toggleFocusSession = () => {
    if (focusActive) {
      setFocusActive(false)
      return
    }
    if (focusSecondsLeft <= 0) setFocusSecondsLeft(focusMinutes * 60)
    setFocusActive(true)
  }
  const recordKhatmahPages = () => {
    const requestedPages = Math.max(0, Math.floor(Number(pagesToLog) || 0))
    if (!requestedPages || khatmah.completedPages >= TOTAL_MUSHAF_PAGES) return

    setKhatmah((previous) => {
      const addedPages = Math.min(requestedPages, TOTAL_MUSHAF_PAGES - previous.completedPages)
      return {
        ...previous,
        completedPages: previous.completedPages + addedPages,
        log: {
          ...previous.log,
          [todayKey]: (Number(previous.log[todayKey]) || 0) + addedPages,
        },
      }
    })
    setPagesToLog(1)
  }
  const openKhatmah = () => {
    setSurahIndex(khatmah.bookmark.surahIndex)
    setPage(khatmah.bookmark.page)
    setKhatmahSavedMessage('')
    setMode('khatmah')
  }
  const startKhatmah = () => {
    if (!khatmah.started) {
      setSurahIndex(0)
      setPage(0)
      setKhatmah((previous) => ({
        ...previous,
        started: true,
        bookmark: { surahIndex: 0, page: 0 },
      }))
    } else {
      setSurahIndex(khatmah.bookmark.surahIndex)
      setPage(khatmah.bookmark.page)
    }
    setKhatmahSavedMessage('')
  }
  const saveKhatmahPosition = () => {
    const bookmark = { surahIndex, page }
    setKhatmah((previous) => ({ ...previous, started: true, bookmark }))
    setKhatmahSavedMessage(`تم حفظ موضع القراءة: سورة ${currentSurah.a}، الصفحة ${ar(page + 1)}.`)
  }
  const coachPlan = useMemo(() => {
    const steps = []

    if (nextDueReview) {
      steps.push({
        title: 'ابدأ بالمراجعة المستحقة',
        detail: `سورة ${surahName(nextDueReview.surahIndex)} · ${formatReviewDueLabel(nextDueReview.dueAt)}. تَلُها من حفظك ثم تحقّق منها.`,
        tone: 'primary',
        action: 'due',
      })
    }

    if (todayCount < dailyGoal) {
      steps.push({
        title: 'أكمل هدف اليوم',
        detail: `بقي ${ar(Math.max(0, dailyGoal - todayCount))} كلمة. احفظ مقطعًا قصيرًا ثم صِله بما قبله.`,
        tone: 'secondary',
        action: 'goal',
      })
    }

    if (strongestReviewTarget) {
      const targetSurah = Q[strongestReviewTarget.surahIndex]
      steps.push({
        title: 'ركّز على موضع الضعف',
        detail: `سورة ${targetSurah?.a || 'هذه السورة'} · ${ar(strongestReviewTarget.count)} مواضع تحتاج إلى مراجعة. تمهّل عند الانتقالات.`,
        tone: 'warning',
        action: 'weak',
      })
    }

    if (reviewFocusDetails[0]) {
      steps.push({
        title: 'آية للتركيز',
        detail: `الآية ${ar(reviewFocusDetails[0].verseIndex + 1)} هي أكثر مواضع الضعف تكرارًا. استحضر بدايتها ثم تَلُها كاملة.`,
        tone: 'neutral',
        action: 'verse',
      })
    }

    return steps.slice(0, 3)
  }, [dailyGoal, nextDueReview, reviewFocusDetails, strongestReviewTarget, todayCount])
  const handleCoachAction = (action) => {
    if (action === 'due' && nextDueReview) {
      jumpToWeakestSurah(nextDueReview.surahIndex)
      return
    }
    if (action === 'goal') {
      jumpToWeakestSurah(surahIndex)
      return
    }
    if (action === 'weak') {
      handleReviewQueue()
      return
    }
    if (action === 'verse') jumpToWeakestSurah(reviewFocusIndex)
  }
  const totalWordsInSession = Math.max(1, rec.f.length)
  const sessionAccuracy = useMemo(() => {
    const sessionMistakes = rec.mistakes?.length || 0
    return Math.max(0, Math.round((1 - sessionMistakes / totalWordsInSession) * 100))
  }, [rec.f.length, rec.mistakes])

  const surahReviewStats = useMemo(() => {
    const map = new Map()
    mistakes.forEach((item) => {
      const key = Number(item.surahIndex ?? 0)
      map.set(key, (map.get(key) || 0) + 1)
    })

    return [...Q.entries()].map(([index, surah]) => ({
      index,
      name: surah.a,
      count: map.get(index) || 0,
    })).sort((a, b) => b.count - a.count)
  }, [mistakes])

  const stopAudioPlayback = () => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.onerror = null
      audio.removeAttribute('src')
      audio.load()
    }
    setIsSpeaking(false)
  }

  const jumpToWeakestSurah = (targetIndex = null) => {
    stopAudioPlayback()
    const weakest = [...Q.entries()].sort((a, b) => {
      const valueA = (done[a[0]] || []).length / a[1].v.length
      const valueB = (done[b[0]] || []).length / b[1].v.length
      return valueA - valueB
    })[0]

    const nextTarget = targetIndex !== null ? targetIndex : (strongestReviewTarget?.surahIndex ?? weakest?.[0])
    if (nextTarget === undefined || nextTarget === null) return
    setSurahIndex(nextTarget)
    setPage(0)
    setMode('recite')
    setShownWords({})
    setRec(defaultRecState())
    setListening(false)
    if (recognitionRef.current) recognitionRef.current.stop()
  }

  const revealWord = (key) => {
    setShownWords((prev) => ({ ...prev, [key]: true }))
  }

  const handleReviewQueue = () => {
    if (!strongestReviewTarget) {
      jumpToWeakestSurah()
      return
    }

    jumpToWeakestSurah(strongestReviewTarget.surahIndex)
  }

  const handleReviewComplete = async (id) => {
    if (!id) return
    await markReviewComplete(id)
    setReviewQueue((previous) => previous.filter((item) => item.id !== id))
  }

  const toggleVerse = (verseIndex) => {
    setDone((prev) => {
      const current = prev[surahIndex] || []
      const exists = current.includes(verseIndex)
      const nextList = exists ? current.filter((v) => v !== verseIndex) : [...current, verseIndex]

      setStudyLog((existing) => {
        const dateKey = new Date().toISOString().slice(0, 10)
        const currentCount = existing[dateKey] || 0
        return {
          ...existing,
          [dateKey]: exists ? Math.max(currentCount - 1, 0) : currentCount + 1,
        }
      })

      return { ...prev, [surahIndex]: nextList }
    })
  }

  const buildRecitation = () => {
    const wordsList = []
    for (let verseIndex = verseStart; verseIndex < verseEnd; verseIndex += 1) {
      words(currentSurah.v[verseIndex]).forEach((word, wordIndex) => {
        wordsList.push({ v: verseIndex, i: wordIndex, w: word, n: norm(word) })
      })
    }
    return {
      key: `${surahIndex}:${page}`,
      f: wordsList,
      pos: 0,
      start: 0,
      flawed: new Set(),
      hint: '',
      hl: 0,
      mist: 0,
      msg: '',
      fin: false,
    }
  }

  const feedSpeech = (text) => {
    setRec((previous) => {
      if (!previous || previous.fin) return previous
      let position = previous.start
      let tail = 0
      const tokens = text.split(/\s+/).filter(Boolean)
      const next = {
        ...previous,
        flawed: new Set(previous.flawed),
        mistakes: [...(previous.mistakes || [])],
      }

      if (Q[surahIndex].b && page === 0 && previous.start === 0) {
        let index = 0
        while (index < 4 && tokens[index] && match(norm(tokens[index]), norm(BASM.split(' ')[index] || ''), sensitivity)) {
          index += 1
        }
        if (index >= 1) {
          tokens.splice(0, index)
        }
      }

      tokens.forEach((token) => {
        const normalized = norm(token)
        if (!normalized || position >= next.f.length) return
        if (match(normalized, next.f[position].n, sensitivity)) {
          position += 1
          while (position < next.f.length && !next.f[position].n) {
            position += 1
          }
          tail = 0
        } else {
          tail += 1
        }
      })

      if (position > next.pos) {
        next.pos = position
        next.hint = ''
        next.hl = 0
      }

      if (tail >= 2 && !next.hl && next.pos < next.f.length) {
        const word = next.f[next.pos]
        if (word) {
          next.mist += 1
          next.flawed.add(word.v)
          next.hl = 1
          next.hint = head(word.w, 2) + ' …'
        }
      }

      if (next.pos >= next.f.length) {
        next.fin = true
        const nextDone = done[surahIndex] || []
        const verseSet = new Set(next.f.map((entry) => entry.v))
        verseSet.forEach((verse) => {
          if (!next.flawed.has(verse) && !nextDone.includes(verse)) {
            nextDone.push(verse)
          }
        })
        setDone((prev) => ({ ...prev, [surahIndex]: nextDone }))
        next.msg = 'اكتمل هذا المقطع.'
        setListening(false)
        if (recognitionRef.current) {
          recognitionRef.current.stop()
        }
      }

      const expectedWords = next.f.slice(next.pos).map((entry) => ({
        word: entry.w,
        normalized: entry.n,
      }))
      const classification = classifySpeech(tokens, expectedWords, sensitivity)
      const lastIssue = classification.issues.at(-1) || null

      if (lastIssue) {
        const issue = {
          ...lastIssue,
          expected: lastIssue.expected || next.f[next.pos]?.w || '',
          said: lastIssue.said || '',
          surahIndex,
          verseIndex: next.f[next.pos]?.v ?? page,
          wordIndex: next.f[next.pos]?.i ?? 0,
          type: lastIssue.type,
        }

        next.mistakes = [...next.mistakes, issue]
        next.currentIssue = issue

        void saveMistake(issue).then(() => {
          setMistakes((prev) => [issue, ...prev])
        })

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(25)
        }
      } else {
        next.currentIssue = null
      }

      return next
    })
  }

  const startRecitation = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setRec((previous) => ({ ...previous, msg: 'التعرّف على الكلام غير مدعوم في هذا المتصفح. جرّب متصفحًا آخر يدعم هذه الميزة.' }))
      return
    }

    const nextRec = buildRecitation()
    nextRec.msg = 'جارٍ الاستماع…'
    setRec(nextRec)

    const recognition = new SpeechRecognition()
    recognition.lang = 'ar-SA'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += ` ${event.results[index][0].transcript}`
      }
      feedSpeech(transcript)
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setListening(false)
        setRec((previous) => ({
          ...previous,
          msg: 'الميكروفون محظور. اسمح باستخدامه في المتصفح، أو افتح الصفحة في علامة تبويب مستقلة.',
        }))
      }
    }
    recognition.onend = () => {
      if (listening && !rec.fin) {
        try {
          recognition.start()
        } catch {
          /* ignore */
        }
      } else {
        setListening(false)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  const stopRecitation = () => {
    setListening(false)
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }

  const recordMistake = (issue, wordIndex = 0, verseIndex = page) => {
    const payload = {
      ...issue,
      surahIndex,
      verseIndex,
      wordIndex,
      type: issue.type,
      expected: issue.expected || '',
      said: issue.said || '',
    }

    void saveMistake(payload).then(() => {
      setMistakes((prev) => [payload, ...prev])
    })
  }

  const handleHint = () => {
    setRec((previous) => {
      if (!previous || previous.fin || previous.pos >= previous.f.length) return previous
      const next = { ...previous, flawed: new Set(previous.flawed), mistakes: [...(previous.mistakes || [])] }
      if (!next.hl) {
        next.mist += 1
        next.flawed.add(next.f[next.pos].v)
      }
      next.hl = next.hl ? 2 : 1
      next.hint = next.hl === 1 ? `${head(next.f[next.pos].w, 2)} …` : next.f[next.pos].w
      const issue = {
        type: 'peek',
        expected: next.f[next.pos].w,
        said: 'peek',
        surahIndex,
        verseIndex: next.f[next.pos].v,
        wordIndex: next.f[next.pos].i ?? 0,
      }
      next.currentIssue = issue
      next.mistakes = [...next.mistakes, issue]
      recordMistake(issue, issue.wordIndex, issue.verseIndex)
      return next
    })
  }

  const handlePeek = () => {
    setRec((previous) => {
      if (!previous || previous.fin || previous.pos >= previous.f.length) return previous
      const word = previous.f[previous.pos]
      if (!word) return previous

      const next = {
        ...previous,
        flawed: new Set(previous.flawed),
        mistakes: [...(previous.mistakes || [])],
      }
      next.mist += 1
      next.peekCount = (previous.peekCount || 0) + 1
      next.hint = `Peek: ${word.w}`
      next.hl = 1
      const issue = {
        type: 'peek',
        expected: word.w,
        said: 'peek',
        surahIndex,
        verseIndex: word.v,
        wordIndex: word.i ?? 0,
      }
      next.currentIssue = issue
      next.mistakes = [...next.mistakes, issue]
      recordMistake(issue, issue.wordIndex, issue.verseIndex)
      return next
    })
  }

  const handleAudioToggle = () => {
    if (typeof window === 'undefined') return
    const player = audioRef.current

    if (isSpeaking || (player && !player.paused)) {
      stopAudioPlayback()
      return
    }

    const audio = player || new Audio()
    audioRef.current = audio
    const surahNumber = String(surahIndex + 1).padStart(3, '0')
    let verseOffset = 0
    setAudioError('')

    const playNextVerse = () => {
      if (verseStart + verseOffset >= verseEnd) {
        setIsSpeaking(false)
        return
      }

      const verseNumber = String(verseStart + verseOffset + 1).padStart(3, '0')
      audio.src = `https://everyayah.com/data/Alafasy_128kbps/${surahNumber}${verseNumber}.mp3`
      audio.onended = () => {
        verseOffset += 1
        playNextVerse()
      }
      audio.onerror = () => {
        setIsSpeaking(false)
        setAudioError('تعذّر تحميل التلاوة. تحقّق من اتصال الإنترنت وحاول مجددًا.')
      }
      audio.play().then(() => {
        if (!audio.paused) setIsSpeaking(true)
      }).catch(() => {
        setIsSpeaking(false)
        setAudioError('تعذّر تشغيل التلاوة. تحقّق من اتصال الإنترنت وحاول مجددًا.')
      })
    }

    playNextVerse()
  }

  const pageMessages = useMemo(() => {
    const completion = Math.round((currentCompleted.length / currentSurah.v.length) * 100)
    return `${ar(currentCompleted.length)} / ${ar(currentSurah.v.length)} محفوظة · ${ar(completion)}٪`
  }, [currentCompleted.length, currentSurah.v.length])

  const handleSurahChange = (event) => {
    stopAudioPlayback()
    const nextSurah = Number(event.target.value)
    setSurahIndex(nextSurah)
    setPage(0)
    setShownWords({})
    setRec(defaultRecState())
    setListening(false)
    stopRecitation()
  }

  const handleNextPage = () => {
    stopAudioPlayback()
    if ((page + 1) * PER < currentSurah.v.length) {
      setPage((prev) => prev + 1)
    } else if (surahIndex < Q.length - 1) {
      setSurahIndex((prev) => prev + 1)
      setPage(0)
    }
    setShownWords({})
    setRec(defaultRecState())
    setListening(false)
  }

  const handlePreviousPage = () => {
    stopAudioPlayback()
    if (page > 0) {
      setPage((prev) => prev - 1)
    } else if (surahIndex > 0) {
      setSurahIndex((prev) => prev - 1)
      setPage(Math.ceil(Q[surahIndex - 1].v.length / PER) - 1)
    }
    setShownWords({})
    setRec(defaultRecState())
    setListening(false)
  }

  const handlePagePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target.closest('button, input, select, [role="button"]')) return
    pageSwipeStartRef.current = { x: event.clientX, y: event.clientY }
  }

  const handlePagePointerUp = (event) => {
    const start = pageSwipeStartRef.current
    pageSwipeStartRef.current = null
    if (!start) return

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return

    if (deltaX < 0) handleNextPage()
    else handlePreviousPage()
  }

  const resetPagePointer = () => {
    pageSwipeStartRef.current = null
  }

  const renderReadMode = () => {
    return (
      <>
        {page === 0 && (
          <div className="sh">
            سورة {currentSurah.a}
            <small>
              {currentSurah.a} · {ar(currentSurah.v.length)} آية
            </small>
          </div>
        )}
        {currentSurah.b > 0 && page === 0 && <div className="bs">{BASM}</div>}

        <div className="txt">
          {currentSurah.v.slice(verseStart, verseEnd).map((verseText, verseOffset) => {
            const verseIndex = verseStart + verseOffset
            const isDone = currentCompleted.includes(verseIndex)
            return (
              <span key={verseIndex} className={`m ${isDone ? 'on' : ''}`}>
                {words(verseText).map((word, wordIndex) => {
                  const key = `${verseIndex}-${wordIndex}`
                  const shouldHide = rank(surahIndex, verseIndex, wordIndex) < LV[hiddenLevel][1] && !shownWords[key]
                  return (
                    <span
                      key={key}
                      className={`w ${shouldHide ? 'h' : ''}`}
                      onClick={() => shouldHide && revealWord(key)}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && shouldHide) {
                          event.preventDefault()
                          revealWord(key)
                        }
                      }}
                      tabIndex={shouldHide ? 0 : -1}
                      role={shouldHide ? 'button' : undefined}
                      aria-label={shouldHide ? 'كلمة مخفية، اضغط لإظهارها' : undefined}
                    >
                      {word}{' '}
                    </span>
                  )
                })}
                <span
                  className={`ve ${isDone ? 'on' : ''}`}
                  onClick={() => toggleVerse(verseIndex)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleVerse(verseIndex)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`الآية ${ar(verseIndex + 1)}${isDone ? '، محفوظة' : '، تحديدها كمحفوظة'}`}
                >
                  {ar(verseIndex + 1)}
                </span>{' '}
              </span>
            )
          })}
        </div>
      </>
    )
  }

  const renderReviewMode = () => (
    <div className="review-page">
      <div className="review-header">
        <div>
          <div className="review-title">لوحة المراجعة</div>
          <h3>مراجعة مركّزة</h3>
        </div>
        <button type="button" className="primary" onClick={() => jumpToWeakestSurah()}>ابدأ بأضعف سورة</button>
      </div>

      <div className="focus-summary">
        <div>
          <span className="focus-label">الأولوية</span>
          <strong>{focusSurahName}</strong>
        </div>
        <div className="focus-meta">{reviewPriorityLabel}</div>
      </div>

      <div className="review-plan-grid">
        {reviewPlan.map((step) => (
          <div key={step.label} className="review-plan-card">
            <span>{step.label}</span>
            <strong>{step.value}</strong>
            <small>{step.meta}</small>
          </div>
        ))}
      </div>

      <div className="review-panel">
        <div className="review-title">مراجعات مستحقة الآن</div>
        {dueReviews.length ? (
          dueReviews.slice(0, 6).map((item) => (
            <div key={item.id} className="review-entry review-entry-large">
              <div className="review-entry-copy">
                <strong>{surahName(item.surahIndex)}</strong>
                <small>{formatReviewDueLabel(item.dueAt)}</small>
              </div>
              <div className="review-entry-actions">
                <button type="button" className="soft-button" onClick={() => jumpToWeakestSurah(item.surahIndex)}>فتح</button>
                <button type="button" className="soft-button" onClick={() => void handleReviewComplete(item.id)}>تمت</button>
              </div>
            </div>
          ))
        ) : (
          <div className="review-empty">لا توجد مراجعات مستحقة الآن.</div>
        )}
      </div>

      <div className="drilldown-panel">
        <div className="review-title">تفاصيل مواضع التركيز</div>
        <div className="drilldown-header">
          <strong>{surahName(reviewFocusIndex)}</strong>
          <span>{ar((done[reviewFocusIndex] || []).length)}/{ar(Q[reviewFocusIndex]?.v.length || 0)} آية</span>
        </div>
        {reviewFocusDetails.length ? (
          <div className="drilldown-list">
            {reviewFocusDetails.map((item) => (
              <div key={item.verseIndex} className="drilldown-item">
                <div>
                  <small>الآية {ar(item.verseIndex + 1)}</small>
                  <div>{item.preview || 'آية تحتاج إلى مراجعة'}</div>
                </div>
                <span className="drilldown-count">{ar(item.count)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="review-empty">لا توجد بيانات عن مواضع الضعف في هذه السورة بعد.</div>
        )}
      </div>

      <div className="review-board">
        <div className="review-title">السور الأضعف</div>
        <div className="review-board-grid">
          {surahReviewStats.slice(0, 8).map((item) => (
            <button key={item.index} type="button" className="review-board-card" onClick={() => jumpToWeakestSurah(item.index)}>
              <span>{item.name}</span>
              <strong>{ar(item.count)}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="review-history">
        <div className="review-title">المراجعات المكتملة</div>
        {reviewHistory.length ? (
          reviewHistory.slice(0, 5).map((item) => (
            <div key={item.id} className="review-history-item">
              <span>{surahName(item.surahIndex)}</span>
              <small>{new Date(item.completedAt).toLocaleDateString('ar-SA-u-ca-gregory')}</small>
            </div>
          ))
        ) : (
          <div className="review-empty">لا توجد مراجعات مكتملة بعد.</div>
        )}
      </div>
    </div>
  )

  const renderKhatmahMode = () => (
    <div className="khatmah-layout">
      <aside className="khatmah-brand-panel">
        <img src="/hifz-logo.svg" alt="" width="48" height="48" />
        <span className="khatmah-brand-name">ختمة</span>
        <p>رحلتك مع القرآن</p>
      </aside>

      <section className="khatmah-progress-panel" aria-label="تقدّم الختمة والورد">
        <div className="khatmah-heading">
          <div className="dashboard-title">الختمة والورد</div>
          <h2>ختمة القرآن</h2>
        </div>

        <div className="khatmah-stats">
          <div className="khatmah-stat">
            <span>الصفحات المقروءة</span>
            <strong>{ar(khatmah.completedPages)} / {ar(TOTAL_MUSHAF_PAGES)}</strong>
          </div>
          <div className="khatmah-stat">
            <span>الصفحات المتبقية</span>
            <strong>{ar(khatmahRemainingPages)}</strong>
          </div>
          <div className="khatmah-stat">
            <span>الأيام المتوقعة</span>
            <strong>{ar(khatmahDaysRemaining)} يوم</strong>
          </div>
        </div>

        <div className="khatmah-progress-copy">
          <span>تقدّم الختمة</span>
          <strong>{ar(khatmahProgress)}٪</strong>
        </div>
        <div className="goal-meter khatmah-meter" role="progressbar" aria-label="تقدّم الختمة" aria-valuenow={khatmahProgress} aria-valuemin="0" aria-valuemax="100">
          <span style={{ width: `${khatmahProgress}%` }} />
        </div>

        <div className="khatmah-wird">
          <div className="khatmah-progress-copy">
            <span>الورد اليومي</span>
            <strong>{ar(khatmahTodayPages)} / {ar(khatmah.dailyWird)} صفحة</strong>
          </div>
          <div className="goal-meter" role="progressbar" aria-label="إنجاز الورد اليومي" aria-valuenow={Math.min(100, Math.round((khatmahTodayPages / khatmah.dailyWird) * 100))} aria-valuemin="0" aria-valuemax="100">
            <span style={{ width: `${Math.min(100, Math.round((khatmahTodayPages / khatmah.dailyWird) * 100))}%` }} />
          </div>
        </div>

        <div className="khatmah-controls">
          <label className="goal-label">
            صفحات الورد يوميًا
            <input
              type="number"
              min="1"
              max={TOTAL_MUSHAF_PAGES}
              value={khatmah.dailyWird}
              onChange={(event) => {
                const value = Math.min(TOTAL_MUSHAF_PAGES, Math.max(1, Math.floor(Number(event.target.value) || 1)))
                setKhatmah((previous) => ({ ...previous, dailyWird: value }))
              }}
            />
          </label>
          <label className="goal-label">
            صفحات قرأتها الآن
            <input
              type="number"
              min="1"
              max={TOTAL_MUSHAF_PAGES}
              value={pagesToLog}
              onChange={(event) => setPagesToLog(Math.min(TOTAL_MUSHAF_PAGES, Math.max(1, Math.floor(Number(event.target.value) || 1))))}
            />
          </label>
          <button type="button" className="primary khatmah-submit" onClick={recordKhatmahPages} disabled={khatmahRemainingPages === 0}>
            {khatmahRemainingPages === 0 ? 'أتممت الختمة' : 'حفظ الورد'}
          </button>
        </div>

        <div className="khatmah-saved" role="status">يُحفظ تقدّم الختمة والورد تلقائيًا على هذا الجهاز.</div>
      </section>

      <section className="khatmah-reader-panel" aria-label="قراءة القرآن">
        {!khatmah.started ? (
          <div className="khatmah-reader-empty">
            <h2>ابدأ ختمتك</h2>
            <p>ستظهر آيات القرآن هنا، ويمكنك حفظ موضعك للعودة إليه لاحقًا.</p>
            <button type="button" className="primary khatmah-start" onClick={startKhatmah}>ابدأ الختمة</button>
          </div>
        ) : (
          <div className="khatmah-reader">
            <div className="khatmah-reader-head">
              <div>
                <span>موضع القراءة</span>
                <strong>سورة {currentSurah.a} · الصفحة {ar(page + 1)} من {ar(pageTotal)}</strong>
              </div>
              <button type="button" className="primary" onClick={saveKhatmahPosition}>حفظ موضع القراءة</button>
            </div>
            {khatmahSavedMessage && <div className="khatmah-saved" role="status">{khatmahSavedMessage}</div>}
            <div
              className="khatmah-quran-page"
              onPointerDown={handlePagePointerDown}
              onPointerUp={handlePagePointerUp}
              onPointerCancel={resetPagePointer}
            >
              {renderReadMode()}
            </div>
            <div className="nav khatmah-reader-nav">
              <button type="button" onClick={handlePreviousPage}>السابق</button>
              <span>الصفحة {ar(page + 1)} من {ar(pageTotal)}</span>
              <button type="button" onClick={handleNextPage}>التالي</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )

  const renderReciteMode = () => {
    const pageText = currentSurah.a
    const firstVerse = rec.f[0]?.v ?? verseStart
    const lastVerse = rec.f[rec.f.length - 1]?.v ?? verseEnd - 1
    const currentIssue = rec.currentIssue

    return (
      <>
        {currentIssue && (
          <div className={`mistake-banner ${currentIssue.type || 'wrong'}`}>
            {currentIssue.type === 'wrong' && `قلتَ: ${currentIssue.said || '…'} / الصواب: ${currentIssue.expected || '…'}`}
            {currentIssue.type === 'skipped' && `الكلمة المتروكة: ${currentIssue.expected || '…'}`}
            {currentIssue.type === 'extra' && `كلمة زائدة: ${currentIssue.said || '…'}`}
            {currentIssue.type === 'peek' && `أظهرتَ: ${currentIssue.expected || '…'}`}
          </div>
        )}
        {(!rec.key || !rec.f.length) && (
          <div className="ph">
            {pageText}، الآيات {ar(firstVerse + 1)} إلى {ar(lastVerse + 1)}. الصفحة مخفية. اضغط «ابدأ التلاوة» ثم اقرأ من حفظك.
          </div>
        )}
        {rec.f.length > 0 && (
          <div className="txt">
            {Array.from(new Set(rec.f.map((entry) => entry.v))).map((verseNumber) => {
              const seenWords = rec.f.filter((entry) => entry.v === verseNumber)
              return (
                <span key={verseNumber} className="rec-verse">
                  {seenWords.map((entry) => {
                    if (entry.n && entry.n !== '') {
                      const isIssueWord =
                        currentIssue &&
                        currentIssue.expected &&
                        normalizeArabic(entry.w) === normalizeArabic(currentIssue.expected)

                      return (
                        <span
                          key={`${entry.v}-${entry.i}`}
                          className={isIssueWord ? 'w issue-word' : 'w'}
                        >
                          {rec.pos > rec.f.findIndex((item) => item.v === entry.v && item.i === entry.i) ? `${entry.w} ` : '… '}
                        </span>
                      )
                    }
                    return null
                  })}
                </span>
              )
            })}
            {rec.hint && <span className="hint">{rec.hint}</span>}
            {currentIssue?.type === 'extra' && currentIssue.said && (
              <span className="extra-tag">زائد: {currentIssue.said}</span>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <main className={`app-shell ${mode === 'khatmah' ? 'app-shell-khatmah' : ''}`}>
      <div className="bar">
        <select value={surahIndex} onChange={handleSurahChange} aria-label="السورة">
          {Q.map((surah, index) => (
            <option key={surah.n} value={index}>
              {ar(index + 1)}. {surah.a}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleAudioToggle} aria-label={isSpeaking ? 'إيقاف تلاوة القرآن' : 'تشغيل تلاوة القرآن بصوت مشاري العفاسي'}>
          {isSpeaking ? 'إيقاف التلاوة' : 'تشغيل التلاوة'}
        </button>
        {audioError && <span className="audio-status" role="status" aria-live="polite">{audioError}</span>}
        <button type="button" onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}>
          المظهر
        </button>
      </div>

      <div className="bar">
        <div className="seg" role="group" aria-label="وضع العرض">
          <button type="button" className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
            قراءة
          </button>
          <button type="button" className={mode === 'recite' ? 'active' : ''} onClick={() => setMode('recite')}>
            تسميع
          </button>
          <button type="button" className={mode === 'review' ? 'active' : ''} onClick={() => setMode('review')}>
            مراجعة
          </button>
          <button type="button" className={mode === 'khatmah' ? 'active' : ''} onClick={openKhatmah}>
            الختمة
          </button>
        </div>
      </div>

      {mode === 'khatmah' && renderKhatmahMode()}

      {mode !== 'review' && mode !== 'khatmah' && (
        <div className={`dashboard ${dashboardExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="dashboard-head">
            <div className="dashboard-title">التقدّم</div>
            <label className="goal-label">
              الهدف اليومي:
              <input
                type="number"
                min="5"
                max="200"
                value={dailyGoal}
                onChange={(event) => setDailyGoal(Math.max(5, Number(event.target.value) || 20))}
              />
            </label>
            <button
              type="button"
              className="dashboard-toggle"
              aria-expanded={dashboardExpanded}
              onClick={() => setDashboardExpanded((previous) => !previous)}
            >
              {dashboardExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
            </button>
          </div>
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <span className="dashboard-label">اليوم</span>
              <div className="dashboard-value">{ar(todayCount)}</div>
              <div className="dashboard-sub">{ar(Math.min(100, Math.round((todayCount / dailyGoal) * 100)))}٪ من الهدف</div>
            </div>
            <div className="dashboard-card">
              <span className="dashboard-label">التتابع</span>
              <div className="dashboard-value">{ar(studyStreak)} يوم</div>
              <div className="dashboard-sub">الاستمرارية</div>
            </div>
            <div className="dashboard-card">
              <span className="dashboard-label">هذه السورة</span>
              <div className="dashboard-value">{ar(surahProgress.memorized)}</div>
              <div className="dashboard-sub">{ar(surahProgress.percent)}٪</div>
            </div>
            <div className="dashboard-card">
              <span className="dashboard-label">الجلسة</span>
              <div className="dashboard-value">{ar(sessionAccuracy)}٪</div>
              <div className="dashboard-sub">{ar(Math.max(0, rec.f.length - (rec.mistakes?.length || 0)))} كلمة في هذه المحاولة</div>
            </div>
          </div>

          <div className="streak-strip" aria-label="التقدّم الأسبوعي">
            {weeklyProgress.map((item) => (
              <div key={item.key} className="streak-bar-wrap" title={`${item.short}: ${ar(item.count)} كلمة`}>
                <span className="streak-bar" style={{ height: `${item.height}%` }} />
                <small>{item.short.slice(0, 1)}</small>
              </div>
            ))}
          </div>

          <div className="focus-box">
            <div>
              <span className="focus-label">الهدف اليومي</span>
              <strong>{ar(todayCount)}/{ar(dailyGoal)} كلمة</strong>
            </div>
            <div className="goal-meter" aria-label="إنجاز الهدف اليومي">
              <span style={{ width: `${goalProgress}%` }} />
            </div>
          </div>

          <div className="pulse-box">
            <div className="pulse-title">ملخّص الدراسة</div>
            <div className="pulse-grid">
              <div className="pulse-card">
                <span>هذا الأسبوع</span>
                <strong>{ar(weeklyWordTotal)} كلمة</strong>
              </div>
              <div className="pulse-card">
                <span>أطول تتابع</span>
                <strong>{ar(bestStreak)} يوم</strong>
              </div>
              <div className="pulse-card">
                <span>الأكثر مراجعة</span>
                <strong>{surahReviewStats[0]?.name || 'لا يوجد'}</strong>
              </div>
            </div>
          </div>

          <div className="session-box">
            <div className="session-head">
              <div>
                <span className="focus-label">جلسة تركيز</span>
                <strong>{formatDuration(focusSecondsLeft)}</strong>
              </div>
              <button type="button" className="secondary-button" onClick={toggleFocusSession}>
                {focusActive ? 'إيقاف مؤقت' : 'ابدأ'}
              </button>
            </div>
            <div className="session-controls">
              <label className="goal-label">
                الدقائق:
                <input
                  type="number"
                  min="5"
                  max="60"
                  value={focusMinutes}
                  onChange={(event) => {
                    const value = Math.max(5, Math.min(60, Number(event.target.value) || 15))
                    setFocusMinutes(value)
                    setFocusSecondsLeft(value * 60)
                  }}
                />
              </label>
            </div>
            <div className="goal-meter" aria-label="تقدّم جلسة التركيز">
              <span style={{ width: `${focusProgress}%` }} />
            </div>
          </div>

          <div className="coach-box">
            <div className="coach-title">الموجّه</div>
            <div className="coach-message">{coachMessage}</div>
          </div>

          <div className="coach-plan">
            {coachPlan.map((step) => (
              <div key={step.title} className={`coach-plan-item ${step.tone}`}>
                <div className="coach-plan-copy">
                  <span>{step.title}</span>
                  <strong>{step.detail}</strong>
                </div>
                  <button type="button" className="coach-action" onClick={() => handleCoachAction(step.action)}>
                  تدرّب
                </button>
              </div>
            ))}
          </div>

          <div className="revision-list">
            {revisionQueue.map((item) => (
              <div key={item.index} className="revision-item">
                <div>
                  <strong>{item.name}</strong>
                  <div>
                    {ar(item.memorized)}/{ar(item.verses)} آية
                  </div>
                </div>
                <div>{ar(item.percent)}٪</div>
              </div>
            ))}
          </div>
          <div className="review-panel">
            <div className="review-title">مواضع تحتاج إلى مراجعة</div>
            {(dueReviewSummary.length || reviewSummary.length) ? (
              (dueReviewSummary.length ? dueReviewSummary : reviewSummary).slice(0, 3).map((item) => (
                <div key={item.surahIndex} className={`review-item ${strongestReviewTarget?.surahIndex === item.surahIndex ? 'highlight' : ''}`}>
                  <span>{surahName(item.surahIndex)}</span>
                  <strong>{ar(item.count)}</strong>
                </div>
              ))
            ) : (
              <div className="review-empty">لم تُسجّل أخطاء بعد.</div>
            )}
            {dueReviews.length > 0 && <div className="review-subtle">{ar(dueReviews.length)} مراجعات مستحقة الآن</div>}
          </div>

          <div className="review-queue">
            <div className="review-title">مراجعة اليوم</div>
            {dueReviews.length ? (
              dueReviews.slice(0, 4).map((item) => (
                <div key={item.id} className="review-entry">
                  <div className="review-entry-copy">
                    <strong>{surahName(item.surahIndex)}</strong>
                    <small>{formatReviewDueLabel(item.dueAt)}</small>
                  </div>
                  <div className="review-entry-actions">
                    <button type="button" className="soft-button" onClick={() => jumpToWeakestSurah(item.surahIndex)}>فتح</button>
                    <button type="button" className="soft-button" onClick={() => void handleReviewComplete(item.id)}>تمت</button>
                  </div>
                </div>
              ))
            ) : (
              <div className="review-empty">لا توجد مراجعات مستحقة الآن. واصل الحفظ.</div>
            )}
            {nextDueReview && (
              <div className="review-next">التالي: سورة {surahName(nextDueReview.surahIndex)}</div>
            )}
          </div>

          <div className="review-actions">
            <button type="button" className="focus-button" onClick={handleReviewQueue}>
              {strongestReviewTarget ? `راجع سورة ${surahName(strongestReviewTarget.surahIndex)}` : 'راجع أضعف سورة'}
            </button>
            <button type="button" className="secondary-button" onClick={() => jumpToWeakestSurah()}>أضعف سورة</button>
          </div>
        </div>
      )}

      <div className="bar" hidden={mode !== 'read'}>
        <div className="seg" role="group" aria-label="إخفاء الكلمات">
          {LV.map(([label, ratio], index) => (
            <button
              key={label}
              type="button"
              className={hiddenLevel === index ? 'active' : ''}
              onClick={() => setHiddenLevel(index)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bar" hidden={mode !== 'recite'}>
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (listening) {
              stopRecitation()
            } else {
              startRecitation()
            }
          }}
        >
          {listening ? 'إيقاف' : 'ابدأ التلاوة'}
        </button>
        <button type="button" onClick={handleHint}>تلميح</button>
        <button type="button" onMouseDown={handlePeek} onTouchStart={handlePeek}>اضغط مطولًا للإظهار</button>
        <button type="button" onClick={() => { setRec(defaultRecState()); setListening(false); if (recognitionRef.current) recognitionRef.current.stop(); }}>
          إعادة البدء
        </button>
      </div>

      <div className="bar" hidden={mode !== 'recite'}>
        <label className="sensitivity-picker">
          دقة المطابقة
          <select value={sensitivity} onChange={(event) => setSensitivity(event.target.value)}>
            {Object.entries(SENSITIVITY_LEVELS).map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="info" hidden={mode !== 'recite'}>
        <span className={listening ? 'live' : ''}>{rec.msg || (listening ? 'جارٍ الاستماع… ابدأ التلاوة من الآية الأولى' : `التلميحات المستخدمة: ${ar(rec.mist)}`)}</span>
      </div>

      <div className="info" hidden={mode === 'khatmah'}>
        <span>{pageMessages}</span>
        <span>{currentSurah.a}</span>
      </div>

      <div className="pb" hidden={mode === 'khatmah'}>
        <i style={{ width: `${Math.round((currentCompleted.length / currentSurah.v.length) * 100)}%` }} />
      </div>

      <div
        className={`page ${mode === 'recite' ? 'page-recite' : ''}`}
        hidden={mode === 'khatmah'}
        onPointerDown={mode === 'read' ? handlePagePointerDown : undefined}
        onPointerUp={mode === 'read' ? handlePagePointerUp : undefined}
        onPointerCancel={mode === 'read' ? resetPagePointer : undefined}
      >
        {mode === 'read' && renderReadMode()}
        {mode === 'recite' && renderReciteMode()}
        {mode === 'review' && renderReviewMode()}
      </div>

      <div className="nav" hidden={mode === 'khatmah'}>
        <button type="button" onClick={handlePreviousPage}>السابق</button>
        <span>
          الصفحة {ar(page + 1)} من {ar(pageTotal)}
        </span>
        <button type="button" onClick={handleNextPage}>التالي</button>
      </div>

      <p className="note" hidden={mode === 'khatmah'}>
        اضغط رقم الآية لتحديدها كمحفوظة، واضغط الكلمة المخفية لإظهارها. يقتصر التعرّف على الكلمات ولا يقيّم أحكام التجويد. راجع مصحفًا مطبوعًا واستمع إلى معلّم متقن للتجويد.
      </p>
    </main>
  )
}

export default App

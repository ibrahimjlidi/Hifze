import { useEffect, useMemo, useRef, useState } from 'react'
import { BASM, LV, PER, Q } from './quranData'
import { SENSITIVITY_LEVELS, classifySpeech, normalizeArabic, wordMatches } from './lib/arabic'
import { getDueReviews, getMistakes, getReviewHistory, getReviewQueue, getReviewSummary, markReviewComplete, saveMistake } from './lib/db'
import './App.css'

const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])

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
  const [surahIndex, setSurahIndex] = useState(0)
  const [page, setPage] = useState(0)
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
  const [focusMinutes, setFocusMinutes] = useState(15)
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(15 * 60)
  const [focusActive, setFocusActive] = useState(false)
  const [rec, setRec] = useState(defaultRecState)
  const [listening, setListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [sensitivity, setSensitivity] = useState('normal')
  const [mistakes, setMistakes] = useState([])
  const [reviewQueue, setReviewQueue] = useState([])
  const [reviewHistory, setReviewHistory] = useState([])
  const recognitionRef = useRef(null)
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
        const rows = await getReviewQueue()
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
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
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

  useEffect(() => {
    if (!focusActive) {
      setFocusSecondsLeft(focusMinutes * 60)
    }
  }, [focusActive, focusMinutes])

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
      name: surah.n,
      index,
      verses: surah.v.length,
      memorized: (done[index] || []).length,
      percent: surah.v.length ? Math.round(((done[index] || []).length / surah.v.length) * 100) : 0,
    })).sort((a, b) => a.percent - b.percent).slice(0, 3)
  }, [done])

  const todayCount = studyLog[todayKey] || 0
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
        short: date.toLocaleDateString(undefined, { weekday: 'short' }),
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
  const dueReviewSummary = useMemo(() => getReviewSummary(reviewQueue), [reviewQueue])
  const strongestReviewTarget = dueReviewSummary[0] || reviewSummary[0]
  const focusSurahName = strongestReviewTarget ? Q[strongestReviewTarget.surahIndex]?.n || `Surah ${strongestReviewTarget.surahIndex + 1}` : 'Weakest surah'
  const reviewPriorityLabel = strongestReviewTarget ? `${focusSurahName} · ${strongestReviewTarget.count} weak points` : 'No weak points tracked yet'
  const dueReviews = useMemo(() => [...(reviewQueue || [])].sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0)), [reviewQueue])
  const reviewPlan = useMemo(() => [
    { label: 'Open', value: focusSurahName, meta: 'Weakest focus' },
    { label: 'Due', value: String(dueReviews.length), meta: 'Items ready' },
    { label: 'Done', value: String(reviewHistory.length), meta: 'Completed today' },
  ], [dueReviews.length, focusSurahName, reviewHistory.length])
  const coachMessage = useMemo(() => {
    if (dueReviews.length > 0) {
      return `Review ${Q[dueReviews[0].surahIndex]?.n || 'the next surah'} before moving on — it is due now.`
    }
    if (todayCount < dailyGoal) {
      return `You are ${Math.max(0, dailyGoal - todayCount)} words away from today’s goal. Keep the next pass short and focused.`
    }
    if (strongestReviewTarget) {
      return `Your biggest weak spot is ${Q[strongestReviewTarget.surahIndex]?.n || 'this surah'}. Give it a quick recitation pass.`
    }
    return 'Strong momentum. Keep the pace steady and review one short passage before you finish.'
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
    if (!dueAt) return 'Scheduled soon'
    const diffMs = dueAt - Date.now()
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (days <= 0) return 'Due now'
    if (days === 1) return 'Due tomorrow'
    return `Due in ${days} days`
  }
  const formatDuration = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0)
    const minutes = Math.floor(safeSeconds / 60)
    const remainder = safeSeconds % 60
    return `${minutes}:${String(remainder).padStart(2, '0')}`
  }
  const focusProgress = focusMinutes > 0 ? Math.min(100, Math.round(((focusMinutes * 60 - focusSecondsLeft) / (focusMinutes * 60)) * 100)) : 0
  const coachPlan = useMemo(() => {
    const steps = []

    if (nextDueReview) {
      steps.push({
        title: 'Start with due review',
        detail: `${Q[nextDueReview.surahIndex]?.n || 'Next surah'} · ${formatReviewDueLabel(nextDueReview.dueAt)}. Recite once from memory, then check.`,
        tone: 'primary',
        action: 'due',
      })
    }

    if (todayCount < dailyGoal) {
      steps.push({
        title: 'Reach today’s goal',
        detail: `${Math.max(0, dailyGoal - todayCount)} words left. Learn a short chunk, then join it to the previous one.`,
        tone: 'secondary',
        action: 'goal',
      })
    }

    if (strongestReviewTarget) {
      const targetSurah = Q[strongestReviewTarget.surahIndex]
      steps.push({
        title: 'Target weak spot',
        detail: `${targetSurah?.n || 'This surah'} · ${strongestReviewTarget.count} weak points. Slow down at the transitions.`,
        tone: 'warning',
        action: 'weak',
      })
    }

    if (reviewFocusDetails[0]) {
      steps.push({
        title: 'Focus verse',
        detail: `Verse ${reviewFocusDetails[0].verseIndex + 1} is the most repeated weak point. Recall its opening, then recite the full verse.`,
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
      name: surah.n,
      count: map.get(index) || 0,
    })).sort((a, b) => b.count - a.count)
  }, [mistakes])

  const jumpToWeakestSurah = (targetIndex = null) => {
    const weakest = [...Q.entries()].sort((a, b) => {
      const valueA = (done[a[0]] || []).length / a[1].v.length
      const valueB = (done[b[0]] || []).length / b[1].v.length
      return valueA - valueB
    })[0]

    const nextTarget = targetIndex !== null ? targetIndex : weakest?.[0]
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
      words(currentSurah.v[verseIndex]).forEach((word) => {
        wordsList.push({ v: verseIndex, w: word, n: norm(word) })
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
        next.msg = 'Page complete.'
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
      setRec((previous) => ({ ...previous, msg: "Speech recognition isn't supported in this browser. Try Chrome or Safari." }))
      return
    }

    const nextRec = buildRecitation()
    nextRec.msg = 'Listening…'
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
          msg: 'Microphone is blocked. Allow it in your browser, or open this page in its own tab.',
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
    const synth = window.speechSynthesis
    if (!synth) return

    if (isSpeaking || synth.speaking || synth.pending) {
      synth.cancel()
      setIsSpeaking(false)
      return
    }

    const text = currentSurah.v.slice(verseStart, verseEnd).join(' ')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ar-SA'
    utterance.rate = 0.85
    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    synth.cancel()
    synth.speak(utterance)
  }

  const pageMessages = useMemo(() => {
    const completion = Math.round((currentCompleted.length / currentSurah.v.length) * 100)
    return `${currentCompleted.length} / ${currentSurah.v.length} memorized · ${completion}%`
  }, [currentCompleted.length, currentSurah.v.length])

  const handleSurahChange = (event) => {
    const nextSurah = Number(event.target.value)
    setSurahIndex(nextSurah)
    setPage(0)
    setShownWords({})
    setRec(defaultRecState())
    setListening(false)
    stopRecitation()
  }

  const handleNextPage = () => {
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

  const renderReadMode = () => {
    return (
      <>
        {page === 0 && (
          <div className="sh">
            سورة {currentSurah.a}
            <small>
              {currentSurah.n} · {currentSurah.v.length} verses
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
                      aria-label={shouldHide ? 'Hidden word, tap to reveal' : undefined}
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
                  aria-label={`Verse ${verseIndex + 1}${isDone ? ', memorized' : ', mark memorized'}`}
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
          <div className="review-title">Review dashboard</div>
          <h3>Focused revision</h3>
        </div>
        <button type="button" className="primary" onClick={() => jumpToWeakestSurah()}>Start weakest</button>
      </div>

      <div className="focus-summary">
        <div>
          <span className="focus-label">Priority</span>
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
        <div className="review-title">Due now</div>
        {dueReviews.length ? (
          dueReviews.slice(0, 6).map((item) => (
            <div key={item.id} className="review-entry review-entry-large">
              <div className="review-entry-copy">
                <strong>{Q[item.surahIndex]?.n || `Surah ${item.surahIndex + 1}`}</strong>
                <small>{formatReviewDueLabel(item.dueAt)}</small>
              </div>
              <div className="review-entry-actions">
                <button type="button" className="soft-button" onClick={() => jumpToWeakestSurah(item.surahIndex)}>Open</button>
                <button type="button" className="soft-button" onClick={() => void handleReviewComplete(item.id)}>Done</button>
              </div>
            </div>
          ))
        ) : (
          <div className="review-empty">No review items are due yet.</div>
        )}
      </div>

      <div className="drilldown-panel">
        <div className="review-title">Focus drill-down</div>
        <div className="drilldown-header">
          <strong>{Q[reviewFocusIndex]?.n || 'Focus surah'}</strong>
          <span>{(done[reviewFocusIndex] || []).length}/{Q[reviewFocusIndex]?.v.length || 0} verses</span>
        </div>
        {reviewFocusDetails.length ? (
          <div className="drilldown-list">
            {reviewFocusDetails.map((item) => (
              <div key={item.verseIndex} className="drilldown-item">
                <div>
                  <small>Verse {item.verseIndex + 1}</small>
                  <div>{item.preview || 'Weak verse'}</div>
                </div>
                <span className="drilldown-count">{item.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="review-empty">No weak verse data yet for this surah.</div>
        )}
      </div>

      <div className="review-board">
        <div className="review-title">Weakest surahs</div>
        <div className="review-board-grid">
          {surahReviewStats.slice(0, 8).map((item) => (
            <button key={item.index} type="button" className="review-board-card" onClick={() => jumpToWeakestSurah(item.index)}>
              <span>{item.name}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="review-history">
        <div className="review-title">Completed</div>
        {reviewHistory.length ? (
          reviewHistory.slice(0, 5).map((item) => (
            <div key={item.id} className="review-history-item">
              <span>{Q[item.surahIndex]?.n || `Surah ${item.surahIndex + 1}`}</span>
              <small>{new Date(item.completedAt).toLocaleDateString()}</small>
            </div>
          ))
        ) : (
          <div className="review-empty">No completed review entries yet.</div>
        )}
      </div>
    </div>
  )

  const renderReciteMode = () => {
    const pageText = currentSurah.n
    const firstVerse = rec.f[0]?.v ?? verseStart
    const lastVerse = rec.f[rec.f.length - 1]?.v ?? verseEnd - 1
    const currentIssue = rec.currentIssue

    return (
      <>
        {currentIssue && (
          <div className={`mistake-banner ${currentIssue.type || 'wrong'}`}>
            {currentIssue.type === 'wrong' && `You said: ${currentIssue.said || '…'} / Correct: ${currentIssue.expected || '…'}`}
            {currentIssue.type === 'skipped' && `Skipped word: ${currentIssue.expected || '…'}`}
            {currentIssue.type === 'extra' && `Extra word: ${currentIssue.said || '…'}`}
            {currentIssue.type === 'peek' && `Peeked: ${currentIssue.expected || '…'}`}
          </div>
        )}
        {(!rec.key || !rec.f.length) && (
          <div className="ph">
            {pageText}, verses {firstVerse + 1} to {lastVerse + 1}. The page is hidden. Tap Start reciting and recite from memory.
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
                          key={`${entry.v}-${entry.w}`}
                          className={isIssueWord ? 'w issue-word' : 'w'}
                        >
                          {rec.pos > rec.f.findIndex((item) => item.v === entry.v && item.w === entry.w) ? `${entry.w} ` : '… '}
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
              <span className="extra-tag">Extra: {currentIssue.said}</span>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <main className="app-shell">
      <div className="bar">
        <select value={surahIndex} onChange={handleSurahChange} aria-label="Surah">
          {Q.map((surah, index) => (
            <option key={surah.n} value={index}>
              {index + 1}. {surah.n} · {surah.a}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleAudioToggle}>
          {isSpeaking ? 'Stop audio' : 'Play audio'}
        </button>
        <button type="button" onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}>
          Theme
        </button>
      </div>

      <div className="bar">
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')}>
            Read
          </button>
          <button type="button" className={mode === 'recite' ? 'active' : ''} onClick={() => setMode('recite')}>
            Recite
          </button>
          <button type="button" className={mode === 'review' ? 'active' : ''} onClick={() => setMode('review')}>
            Review
          </button>
        </div>
      </div>

      {mode !== 'review' && (
        <div className="dashboard">
          <div className="dashboard-head">
            <div className="dashboard-title">Progress</div>
            <label className="goal-label">
              Daily goal:
              <input
                type="number"
                min="5"
                max="200"
                value={dailyGoal}
                onChange={(event) => setDailyGoal(Math.max(5, Number(event.target.value) || 20))}
              />
            </label>
          </div>
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <span className="dashboard-label">Today</span>
              <div className="dashboard-value">{todayCount}</div>
              <div className="dashboard-sub">{Math.min(100, Math.round((todayCount / dailyGoal) * 100))}% of goal</div>
            </div>
            <div className="dashboard-card">
              <span className="dashboard-label">Streak</span>
              <div className="dashboard-value">{studyStreak}d</div>
              <div className="dashboard-sub">Consistency</div>
            </div>
            <div className="dashboard-card">
              <span className="dashboard-label">This Surah</span>
              <div className="dashboard-value">{surahProgress.memorized}</div>
              <div className="dashboard-sub">{surahProgress.percent}%</div>
            </div>
            <div className="dashboard-card">
              <span className="dashboard-label">Session</span>
              <div className="dashboard-value">{sessionAccuracy}%</div>
              <div className="dashboard-sub">{Math.max(0, rec.f.length - (rec.mistakes?.length || 0))} words this pass</div>
            </div>
          </div>

          <div className="streak-strip" aria-label="Weekly progress">
            {weeklyProgress.map((item) => (
              <div key={item.key} className="streak-bar-wrap" title={`${item.short}: ${item.count} words`}>
                <span className="streak-bar" style={{ height: `${item.height}%` }} />
                <small>{item.short.slice(0, 1)}</small>
              </div>
            ))}
          </div>

          <div className="focus-box">
            <div>
              <span className="focus-label">Daily focus</span>
              <strong>{todayCount}/{dailyGoal} words</strong>
            </div>
            <div className="goal-meter" aria-label="Daily goal progress">
              <span style={{ width: `${goalProgress}%` }} />
            </div>
          </div>

          <div className="pulse-box">
            <div className="pulse-title">Study pulse</div>
            <div className="pulse-grid">
              <div className="pulse-card">
                <span>This week</span>
                <strong>{weeklyWordTotal} words</strong>
              </div>
              <div className="pulse-card">
                <span>Best streak</span>
                <strong>{bestStreak} days</strong>
              </div>
              <div className="pulse-card">
                <span>Top review</span>
                <strong>{surahReviewStats[0]?.name || 'N/A'}</strong>
              </div>
            </div>
          </div>

          <div className="session-box">
            <div className="session-head">
              <div>
                <span className="focus-label">Focus session</span>
                <strong>{formatDuration(focusSecondsLeft)}</strong>
              </div>
              <button type="button" className="secondary-button" onClick={() => setFocusActive((previous) => !previous)}>
                {focusActive ? 'Pause' : 'Start'}
              </button>
            </div>
            <div className="session-controls">
              <label className="goal-label">
                Minutes:
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
            <div className="goal-meter" aria-label="Focus session progress">
              <span style={{ width: `${focusProgress}%` }} />
            </div>
          </div>

          <div className="coach-box">
            <div className="coach-title">Coach</div>
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
                  Practice
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
                    {item.memorized}/{item.verses} verses
                  </div>
                </div>
                <div>{item.percent}%</div>
              </div>
            ))}
          </div>
          <div className="review-panel">
            <div className="review-title">Mistakes to review</div>
            {(dueReviewSummary.length || reviewSummary.length) ? (
              (dueReviewSummary.length ? dueReviewSummary : reviewSummary).slice(0, 3).map((item) => (
                <div key={item.surahIndex} className={`review-item ${strongestReviewTarget?.surahIndex === item.surahIndex ? 'highlight' : ''}`}>
                  <span>{Q[item.surahIndex]?.n || `Surah ${item.surahIndex + 1}`}</span>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <div className="review-empty">No mistakes recorded yet.</div>
            )}
            {reviewQueue.length > 0 && <div className="review-subtle">{reviewQueue.length} review items due now</div>}
          </div>

          <div className="review-queue">
            <div className="review-title">Today’s review</div>
            {dueReviews.length ? (
              dueReviews.slice(0, 4).map((item) => (
                <div key={item.id} className="review-entry">
                  <div className="review-entry-copy">
                    <strong>{Q[item.surahIndex]?.n || `Surah ${item.surahIndex + 1}`}</strong>
                    <small>{formatReviewDueLabel(item.dueAt)}</small>
                  </div>
                  <div className="review-entry-actions">
                    <button type="button" className="soft-button" onClick={() => jumpToWeakestSurah(item.surahIndex)}>Open</button>
                    <button type="button" className="soft-button" onClick={() => void handleReviewComplete(item.id)}>Done</button>
                  </div>
                </div>
              ))
            ) : (
              <div className="review-empty">No review items are due yet. Keep going.</div>
            )}
            {nextDueReview && (
              <div className="review-next">Next up: {Q[nextDueReview.surahIndex]?.n || `Surah ${nextDueReview.surahIndex + 1}`}</div>
            )}
          </div>

          <div className="review-actions">
            <button type="button" className="focus-button" onClick={handleReviewQueue}>
              {strongestReviewTarget ? `Review ${Q[strongestReviewTarget.surahIndex]?.n || 'this surah'}` : 'Revise weakest surah'}
            </button>
            <button type="button" className="secondary-button" onClick={jumpToWeakestSurah}>Weakest surah</button>
          </div>
        </div>
      )}

      <div className="bar" hidden={mode === 'recite'}>
        <div className="seg" role="group" aria-label="Hidden words">
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
          {listening ? 'Stop' : 'Start reciting'}
        </button>
        <button type="button" onClick={handleHint}>Hint</button>
        <button type="button" onMouseDown={handlePeek} onTouchStart={handlePeek}>Hold to peek</button>
        <button type="button" onClick={() => { setRec(defaultRecState()); setListening(false); if (recognitionRef.current) recognitionRef.current.stop(); }}>
          Restart
        </button>
      </div>

      <div className="bar" hidden={mode !== 'recite'}>
        <label className="sensitivity-picker">
          Sensitivity
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
        <span className={listening ? 'live' : ''}>{rec.msg || (listening ? 'Listening… recite from verse 1' : `Hints used: ${rec.mist}`)}</span>
      </div>

      <div className="info">
        <span>{pageMessages}</span>
        <span>{currentSurah.n}</span>
      </div>

      <div className="pb">
        <i style={{ width: `${Math.round((currentCompleted.length / currentSurah.v.length) * 100)}%` }} />
      </div>

      <div className={`page ${mode === 'recite' ? 'page-recite' : ''}`}>
        {mode === 'read' && renderReadMode()}
        {mode === 'recite' && renderReciteMode()}
        {mode === 'review' && renderReviewMode()}
      </div>

      <div className="nav">
        <button type="button" onClick={handlePreviousPage}>Previous</button>
        <span>
          Page {page + 1} of {pageTotal}
        </span>
        <button type="button" onClick={handleNextPage}>Next</button>
      </div>

      <p className="note">
        Tap the verse number to mark it memorized. Tap a hidden word to reveal it. Word-level detection only; it does not judge tajweed. Verify against a printed mushaf and recite to a teacher for tajweed.
      </p>
    </main>
  )
}

export default App

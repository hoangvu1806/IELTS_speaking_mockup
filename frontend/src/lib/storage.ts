import type { Assessment } from './api'

export interface Attempt {
  t: number
  text: string
  overall: number
  phones: { arpa: string; ipa: string; score: number }[]
}

const KEY = 'pron-history-v1'
const MAX = 500

export function loadHistory(): Attempt[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveAttempt(text: string, r: Assessment) {
  const a: Attempt = {
    t: Date.now(),
    text,
    overall: r.overall,
    phones: r.words.flatMap((w) => w.phones.map((p) => ({ arpa: p.arpa, ipa: p.ipa, score: p.score ?? 0 }))),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([a, ...loadHistory()].slice(0, MAX)))
  } catch {
    /* storage full or blocked */
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function bestScore(text: string): number | null {
  const s = loadHistory().filter((a) => a.text === text).map((a) => a.overall)
  return s.length ? Math.max(...s) : null
}

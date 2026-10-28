import type { Assessment, Status } from './api'

export type Strictness = 'easy' | 'normal' | 'strict'

/** Must mirror STRICTNESS in backend/scorer.py: score = sigmoid((logOdds - offset) / slope). */
const LEVELS: Record<Strictness, [number, number]> = {
  easy: [-1.8, 1.2],
  normal: [-1.0, 1.0],
  strict: [0.4, 1.0],
}

export const STRICTNESS_LABEL: Record<Strictness, string> = {
  easy: 'Dễ',
  normal: 'Vừa',
  strict: 'Khó',
}

const statusOf = (s: number): Status => (s >= 80 ? 'good' : s >= 50 ? 'warn' : 'bad')

/** Re-derive every score from the raw per-phone log-odds for the chosen strictness. */
export function rescore(r: Assessment, level: Strictness): Assessment {
  const [off, slope] = LEVELS[level]
  let sum = 0, n = 0
  const words = r.words.map((w) => {
    if (w.oov || !w.phones.length) return w
    const phones = w.phones.map((p) => {
      if (p.lo == null) return p
      const score = 100 / (1 + Math.exp(-(p.lo - off) / slope))
      return { ...p, score, status: statusOf(score) }
    })
    const ws = phones.reduce((a, p) => a + (p.score ?? 0), 0) / phones.length
    sum += phones.reduce((a, p) => a + (p.score ?? 0), 0)
    n += phones.length
    return { ...w, phones, score: ws }
  })
  return { ...r, words, overall: n ? sum / n : r.overall }
}

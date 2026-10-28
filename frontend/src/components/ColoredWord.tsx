import type { Word } from '../lib/api'
import { statusOf } from './ScoreRing'

/** Score of a letter = worst score among the phonemes it spells. */
export function letterStatuses(word: Word): (string | null)[] {
  const letters = word.letters ?? []
  return [...word.text].map((_, i) => {
    const scores = (letters[i] ?? []).map((p) => word.phones[p]?.score).filter((s): s is number => s != null)
    return scores.length ? statusOf(Math.min(...scores)) : null
  })
}

/** The letters a phoneme is spelled with, e.g. /θ/ -> "th". */
export function lettersOf(word: Word, phoneIdx: number): string {
  const letters = word.letters ?? []
  return [...word.text].filter((_, i) => letters[i]?.includes(phoneIdx)).join('')
}

export function ColoredWord({ word, label }: { word: Word; label: string }) {
  if (word.score == null || !word.letters?.length) return <>{label}</>
  const st = letterStatuses(word)
  return (
    <>
      {[...label].map((ch, i) => (
        <span key={i} className={`letter ${st[i] ?? ''}`}>{ch}</span>
      ))}
    </>
  )
}

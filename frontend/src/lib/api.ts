import { encodeWav } from './audio'

export type Status = 'good' | 'warn' | 'bad'

export interface Phone {
  arpa: string
  ipa: string
  score?: number
  status?: Status
  heard?: string | null
  /** raw log-odds (accepted vs substituted/omitted), used to re-score per strictness */
  lo?: number
  start?: number
  end?: number
}

export interface Word {
  text: string
  start_char: number
  end_char: number
  oov: boolean
  ipa: string
  score?: number | null
  phones: Phone[]
  /** for each letter of `text`, indices into `phones` it spells */
  letters?: number[][]
  start?: number
  end?: number
}

export interface Assessment {
  overall: number
  words: Word[]
  heard_ipa: string
  snr_db?: number
  warning?: string | null
  wpm: number | null
  pauses: { after: string; sec: number }[]
  duration: number
  device: string
  ms: number
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Lỗi máy chủ (${res.status})`
    try {
      msg = (await res.json()).detail ?? msg
    } catch {
      /* not json */
    }
    throw new Error(msg)
  }
  return res.json()
}

export async function health(): Promise<{ ready: boolean; device: string | null; error: string | null }> {
  return json(await fetch('/api/health'))
}

export async function analyze(text: string): Promise<{ words: Word[] }> {
  return json(
    await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  )
}

export interface Prosody {
  overall: number
  intonation: number
  rhythm: number
  pace: number
  pace_ratio: number
  pitch_corr: number
  pitch_range: { ref: number; user: number }
  durations: { ref: number; user: number }
  curves: { ref: (number | null)[]; user: (number | null)[] }
}

/** Shadowing: intonation / rhythm / pace of the take compared with the AI reference voice. */
export async function shadowCompare(text: string, samples: Float32Array, mode = 'chat'): Promise<Prosody> {
  const form = new FormData()
  form.append('text', text)
  form.append('mode', mode)
  form.append('audio', encodeWav(samples), 'shadow.wav')
  return json(await fetch('/api/shadow', { method: 'POST', body: form }))
}

export async function assess(text: string, samples: Float32Array): Promise<Assessment> {
  const form = new FormData()
  form.append('text', text)
  form.append('audio', encodeWav(samples), 'speech.wav')
  return json(await fetch('/api/assess', { method: 'POST', body: form }))
}

import { encodeWav } from './audio'
import type { Assessment } from './api'

export type Mode = 'ielts' | 'chat' | 'coach'

export interface CueCard {
  topic: string
  points: string[]
  closing: string
}

export interface Correction {
  original: string
  fixed: string
  type?: string
  explain_vi: string
}

export interface Feedback {
  corrections: Correction[]
  improved: string
  vocab: { phrase: string; meaning_vi: string; example: string }[]
  comment_vi: string
}

export interface Analysis {
  pron: Assessment | null
  feedback: Feedback | null
  errors: string[]
}

export interface Criterion {
  band: number
  comment_vi: string
}

export interface Report {
  overall: number
  criteria: { fluency: Criterion; lexical: Criterion; grammar: Criterion; pronunciation: Criterion }
  cefr?: string
  summary_vi: string
  strengths_vi: string[]
  weaknesses_vi: string[]
  action_plan_vi: string[]
  key_corrections: Correction[]
  sample_answer?: { question: string; answer: string }
}

export interface ConvConfig {
  configured: boolean
  llm: string
  stt: string
  tts: string
}

export interface HistoryItem {
  role: 'assistant' | 'user'
  text: string
  part?: number | null
  /** teacher mode: whether this turn asked a new question or a retry */
  stage?: 'ask' | 'retry'
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

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const convConfig = async (): Promise<ConvConfig> => json(await fetch('/api/conv/config'))

/** Events of a streamed assistant turn (NDJSON from the backend). */
export type TurnEvent =
  | { type: 'settings'; settings: Record<string, unknown> }
  | { type: 'transcript'; text: string; analysis_id: string }
  | { type: 'meta'; part: number | null; end: boolean; cue_card: CueCard | null; stage?: 'ask' | 'retry' }
  | { type: 'delta'; text: string }
  | { type: 'done'; reply: string }
  | { type: 'error'; message: string }

async function readNdjson(res: Response, onEvent: (e: TurnEvent) => void) {
  if (!res.ok || !res.body) {
    await json(res) // throws with the server's message
    return
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  const handle = (line: string) => {
    if (!line.trim()) return
    const ev = JSON.parse(line) as TurnEvent
    if (ev.type === 'error') throw new Error(ev.message)
    if (!ev.type) throw new Error('Phản hồi máy chủ không đúng định dạng (backend cũ?). Hãy khởi động lại backend.')
    onEvent(ev)
  }
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
    }
  }
  handle(buf)
}

export async function convStart(mode: Mode, settings: Record<string, unknown>, onEvent: (e: TurnEvent) => void) {
  await readNdjson(await post('/api/conv/start', { mode, settings }), onEvent)
}

export async function convTurn(mode: Mode, history: HistoryItem[], settings: Record<string, unknown>,
  input: { samples?: Float32Array; text?: string }, onEvent: (e: TurnEvent) => void) {
  const form = new FormData()
  form.append('mode', mode)
  form.append('history', JSON.stringify(history))
  form.append('settings', JSON.stringify(settings))
  if (input.samples) form.append('audio', encodeWav(input.samples), 'turn.wav')
  else form.append('text', input.text ?? '')
  await readNdjson(await fetch('/api/conv/turn', { method: 'POST', body: form }), onEvent)
}

export const convAnalysis = async (id: string): Promise<Analysis> => json(await fetch(`/api/conv/analysis/${id}`))

export const convReport = async (mode: Mode, history: HistoryItem[], pronSummary: Record<string, unknown>) =>
  json<Report>(await post('/api/conv/report', { mode, history, pron_summary: pronSummary }))

export async function ttsBlob(text: string, mode: Mode): Promise<Blob> {
  const res = await post('/api/tts', { text, mode })
  if (!res.ok) {
    let msg = `TTS lỗi (${res.status})`
    try {
      msg = (await res.json()).detail ?? msg
    } catch {
      /* binary */
    }
    throw new Error(msg)
  }
  return res.blob()
}

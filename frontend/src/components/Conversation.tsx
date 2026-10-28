import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Recorder } from '../lib/audio'
import type { Assessment } from '../lib/api'
import {
  convAnalysis, convConfig, convReport, convStart, convTurn,
  type Analysis, type ConvConfig, type CueCard, type HistoryItem, type Mode, type Report, type TurnEvent,
} from '../lib/conv'
import { rescore, type Strictness } from '../lib/scoring'
import type { Accent } from '../lib/tts'
import { readyFiller, SentenceSplitter, VoicePlayer, warmClip, type Speech } from '../lib/voice'
import { PHONEMES } from '../data/phonemes'
import { ColoredWord } from './ColoredWord'
import { KeyboardIcon, MicIcon, PlayIcon, PrintIcon, SendIcon, SpeakerIcon, Spinner, StopIcon } from './Icons'
import { WordDetail } from './Practice'
import { statusOf } from './ScoreRing'

interface Msg {
  id: string
  role: 'assistant' | 'user'
  text: string
  part?: number | null
  cueCard?: CueCard | null
  stage?: 'ask' | 'retry'
  streaming?: boolean
  pending?: boolean
  typed?: boolean
  samples?: Float32Array
  analysis?: Analysis
  analysisError?: string
}

type Busy = 'idle' | 'starting' | 'recording' | 'transcribing' | 'thinking'
type Phase = 'setup' | 'session' | 'grading' | 'report'

interface SavedReport {
  t: number
  mode: Mode
  overall: number
  bands: number[]
  cefr?: string
  label: string
}

const TOPICS = ['Daily life', 'Food', 'Travel', 'Work & study', 'Movies', 'Technology', 'Hobbies', 'Music', 'Sports', 'Future plans']
const SCENARIOS: [string, string][] = [
  ['', 'Trò chuyện tự do'],
  ['a job interview for a junior position; you are the interviewer', 'Phỏng vấn xin việc'],
  ['the learner is checking in at your hotel; you are the receptionist', 'Check-in khách sạn'],
  ['the learner is ordering food at your restaurant; you are the waiter', 'Gọi món ở nhà hàng'],
  ['the learner is at the airport check-in desk; you are the airline staff', 'Làm thủ tục sân bay'],
  ['the learner wants to return an item at your shop; you are the shop assistant', 'Đổi trả hàng'],
  ['you just met the learner at an international meetup and want to make friends', 'Làm quen bạn mới'],
  ['the learner is seeing you, a doctor, about a health problem', 'Đi khám bác sĩ'],
]
const COACH_TOPICS = ['Hometown', 'Work & study', 'Technology', 'Environment', 'Travel', 'Education', 'Health', 'Family', 'Social media', 'Shopping']

// Short backchannel fillers ("hmm, let me think...") played the instant a real reply is
// taking a moment - exactly what a human conversation partner does while thinking, and it
// masks the pipeline latency (STT + LLM + TTS) the same way. Pre-synthesised and cached at
// the start of the session, so playing one is instant (no network round trip in the way).
// Not used in 'ielts' mode: a real examiner stays neutral and silent while assessing.
const FILLERS: Record<string, string[]> = {
  chat: ['Hmm, let me think...', 'Oh, interesting...', "Let's see...", 'Mm, okay...'],
  coach_en: ['Hmm, let me think about that...', 'Okay, let me see...', 'Right, give me a moment...'],
  coach_vi: ['Hmm, để cô xem nào...', 'Để cô nghĩ một chút...', 'Được rồi, để cô xem...'],
}
const FILLER_DELAY_MS = 650

function fillersFor(mode: Mode, lang: 'en' | 'vi'): string[] {
  if (mode === 'chat') return FILLERS.chat
  if (mode === 'coach') return FILLERS[lang === 'vi' ? 'coach_vi' : 'coach_en']
  return [] // 'ielts': a real examiner stays neutral, no backchannel filler
}
const FOCUS_LABEL: Record<string, string> = { mixed: 'Tổng hợp', part1: 'Part 1', part2: 'Part 2', part3: 'Part 3' }
interface Bank {
  part1: { topic: string; questions: string[] }[]
  part2: { id: string; topic: string; points: string[]; closing: string; part3: string[] }[]
}
const REPORT_KEY = 'conv-reports-v1'
const uid = () => Math.random().toString(36).slice(2, 10)
const bandStatus = (b: number) => statusOf(b >= 7 ? 90 : b >= 5.5 ? 65 : 30)

function loadReports(): SavedReport[] {
  try {
    return JSON.parse(localStorage.getItem(REPORT_KEY) ?? '[]')
  } catch {
    return []
  }
}

interface Props {
  accent: Accent
  strictness: Strictness
  onPractice: (text: string) => void
}

export function Conversation({ accent, strictness, onPractice }: Props) {
  const [config, setConfig] = useState<ConvConfig | null>(null)
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<Mode>('ielts')
  const [level, setLevel] = useState('B1')
  const [topic, setTopic] = useState('')
  const [scenario, setScenario] = useState('')
  const [focus, setFocus] = useState('mixed')
  const [target, setTarget] = useState('7.0')
  const [lang, setLang] = useState<'en' | 'vi'>('vi')
  const [bank, setBank] = useState<Bank | null>(null)
  const [cardId, setCardId] = useState('')
  const [p1Topic, setP1Topic] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState<Busy>('idle')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [showFb, setShowFb] = useState(false)
  const [handsFree, setHandsFree] = useState(true)
  const [typing, setTyping] = useState(false)
  const [cue, setCue] = useState<{ card: CueCard; stage: 'prep' | 'talk'; left: number } | null>(null)
  const [ended, setEnded] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [wordSel, setWordSel] = useState<{ msgId: string; idx: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState<SavedReport[]>(loadReports)

  const player = useMemo(() => new VoicePlayer(), [])
  const recorder = useRef<Recorder | null>(null)
  const recTimer = useRef(0)
  const micLevel = useRef(0)
  const msgsRef = useRef<Msg[]>([])
  const settingsRef = useRef<Record<string, unknown>>({})
  const handsFreeRef = useRef(handsFree)
  const analyses = useRef(new Map<string, Promise<void>>())
  const noSpeechStreak = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)

  useEffect(() => {
    msgsRef.current = msgs
  }, [msgs])
  useEffect(() => {
    handsFreeRef.current = handsFree
  }, [handsFree])
  useEffect(() => {
    player.onChange = setPlaying
    convConfig().then(setConfig).catch(() => setConfig(null))
    fetch('/api/bank').then((r) => r.json()).then(setBank).catch(() => setBank(null))
    alive.current = true
    return () => {
      alive.current = false
      player.stop()
      recorder.current?.cancel()
      clearInterval(recTimer.current)
    }
  }, [player])
  const lastLen = msgs.length ? msgs[msgs.length - 1].text.length : 0
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs.length, lastLen, busy, cue?.stage])

  const patch = (id: string, p: Partial<Msg> | ((m: Msg) => Partial<Msg>)) =>
    setMsgs((all) => all.map((x) => (x.id === id ? { ...x, ...(typeof p === 'function' ? p(x) : p) } : x)))
  const part = [...msgs].reverse().find((m) => m.role === 'assistant' && m.part)?.part ?? null

  // ------------------------------------------------------------------ recording
  const stopRec = useCallback(async (): Promise<Float32Array | null> => {
    const r = recorder.current
    if (!r) return null
    recorder.current = null
    clearInterval(recTimer.current)
    setSpeaking(false)
    micLevel.current = 0
    try {
      return await r.stop()
    } catch {
      return null
    }
  }, [])

  const sendTurnRef = useRef<(input: { samples?: Float32Array; text?: string }) => Promise<void>>(async () => {})

  const startRec = useCallback(async (long = false) => {
    if (recorder.current) return
    player.stop()
    setError('')
    const r = new Recorder()
    const maxSec = long ? 125 : 60
    try {
      await r.start((lv) => { micLevel.current = lv }, {
        // Real conversational turn-taking gaps average ~200ms-1s; 1700ms felt noticeably
        // slower than a human listener. The existing false-start/min-utterance guards (see
        // audio.ts) already protect against cutting off a mid-sentence thinking pause caused
        // by noise or a short "umm", so this can be tightened without new false triggers -
        // the remaining risk is a learner who pauses to think for >1s mid-answer, same as
        // before but with a shorter fuse.
        silenceMs: long ? 3200 : 1000,
        noSpeechMs: long ? 25000 : 12000,
        onSpeechStart: () => setSpeaking(true),
        onFalseStart: () => setSpeaking(false),
        onSpeechEnd: async () => {
          const s = await stopRec()
          if (s) void sendTurnRef.current({ samples: s })
        },
        onNoSpeech: () => {
          if (recorder.current !== r) return
          recorder.current = null
          clearInterval(recTimer.current)
          r.cancel()
          micLevel.current = 0
          setBusy('idle')
          setError('Không nghe thấy giọng nói. Chạm vào micro để thử lại.')
        },
      }, { echoCancellation: true })
    } catch {
      setError('Không truy cập được micro. Hãy cho phép quyền micro trong trình duyệt.')
      return
    }
    recorder.current = r
    setBusy('recording')
    setElapsed(0)
    const t0 = Date.now()
    recTimer.current = window.setInterval(async () => {
      const sec = (Date.now() - t0) / 1000
      setElapsed(sec)
      if (sec >= maxSec) {
        const s = await stopRec()
        if (s) void sendTurnRef.current({ samples: s })
      }
    }, 200)
  }, [player, stopRec])

  // ------------------------------------------------------------------ streamed assistant turns
  /** Consume one streamed turn: text appears token by token and every finished sentence is
   *  spoken immediately, while the rest of the reply is still being generated. */
  const consume = useCallback(async (call: (on: (e: TurnEvent) => void) => Promise<void>, userId?: string,
    onMeta?: () => void) => {
    let aiId = ''
    let speech: Speech | null = null
    let end = false
    let cueCard: CueCard | null = null
    const splitter = new SentenceSplitter()
    await call((ev) => {
      switch (ev.type) {
        case 'settings':
          settingsRef.current = ev.settings
          break
        case 'transcript':
          if (userId) {
            patch(userId, { text: ev.text, pending: false })
            analyses.current.set(userId, convAnalysis(ev.analysis_id)
              .then((a) => patch(userId, { analysis: a }))
              .catch((e) => patch(userId, { analysisError: e instanceof Error ? e.message : String(e) })))
          }
          setBusy('thinking')
          break
        case 'meta': {
          onMeta?.() // the real reply is about to start: cancel any pending backchannel filler
          aiId = uid()
          end = ev.end
          cueCard = ev.cue_card
          setMsgs((m) => [...m, { id: aiId, role: 'assistant', text: '', part: ev.part, cueCard: ev.cue_card, stage: ev.stage, streaming: true }])
          speech = player.begin(aiId, mode)
          setBusy('idle')
          break
        }
        case 'delta':
          patch(aiId, (m) => ({ text: m.text + ev.text }))
          for (const s of splitter.push(ev.text)) speech?.push(s)
          break
        case 'done':
          patch(aiId, { text: ev.reply, streaming: false })
          for (const s of splitter.flush()) speech?.push(s)
          speech?.close()
          break
      }
    })
    if (!aiId) throw new Error('Máy chủ không trả lời (có thể backend vừa khởi động lại). Hãy thử lại.')
    return { aiId, speech: speech as Speech | null, end, cueCard }
  }, [player, mode])

  const afterSpeech = useCallback(async (speech: Speech | null, end: boolean, cueCard: CueCard | null) => {
    let done = true
    try {
      done = speech ? await speech.done : true
    } catch (e) {
      setError(`Không phát được giọng nói: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!alive.current) return
    if (end) {
      setEnded(true)
      return
    }
    if (cueCard) {
      setCue({ card: cueCard, stage: 'prep', left: 60 })
      return
    }
    // short pause so the tail of the AI voice (and room echo) is not captured as the answer
    if (done && handsFreeRef.current) {
      window.setTimeout(() => {
        if (alive.current && handsFreeRef.current && !recorder.current) void startRec(false)
      }, 400)
    }
  }, [startRec])

  const sendTurn = useCallback(async (input: { samples?: Float32Array; text?: string }) => {
    const history: HistoryItem[] = msgsRef.current.filter((m) => !m.pending)
      .map((m) => ({ role: m.role, text: m.text, part: m.part ?? null, stage: m.stage }))
    const userMsg: Msg = { id: uid(), role: 'user', text: input.text ?? '', pending: true, typed: !input.samples,
      samples: input.samples, part }
    setMsgs((m) => [...m, userMsg])
    setBusy(input.samples ? 'transcribing' : 'thinking')
    setCue((c) => (c?.stage === 'talk' ? null : c))
    // Like a human conversation partner who says "hmm" while thinking: if the real reply
    // isn't ready yet after a short moment, play a pre-cached backchannel filler. This masks
    // the STT+LLM+TTS pipeline latency instead of leaving a silent, un-human-like gap.
    const fillerTimer = window.setTimeout(() => {
      if (!alive.current) return
      const phrase = readyFiller(fillersFor(mode, lang), mode)
      if (phrase) void player.play(`filler-${userMsg.id}`, phrase, mode)
    }, FILLER_DELAY_MS)
    try {
      const r = await consume((on) => convTurn(mode, history, settingsRef.current, input, on), userMsg.id,
        () => clearTimeout(fillerTimer))
      noSpeechStreak.current = 0
      void afterSpeech(r.speech, r.end, r.cueCard)
    } catch (e) {
      clearTimeout(fillerTimer)
      const msg = e instanceof Error ? e.message : String(e)
      setMsgs((m) => m.filter((x) => !(x.id === userMsg.id && x.pending)))
      setBusy('idle')
      if (msg.startsWith('NO_SPEECH')) {
        // the server found no real speech in the take (noise / echo): drop it silently
        // and keep listening, but never loop forever
        noSpeechStreak.current++
        if (handsFreeRef.current && noSpeechStreak.current <= 2) {
          window.setTimeout(() => alive.current && !recorder.current && void startRec(false), 300)
        } else {
          setError('Không nghe rõ giọng nói. Hãy nói to, rõ hơn rồi chạm micro để thử lại.')
        }
        return
      }
      setError(msg)
    }
  }, [mode, part, consume, afterSpeech, player, lang])
  sendTurnRef.current = sendTurn

  // Part 2 timers
  useEffect(() => {
    if (!cue) return
    if (cue.stage === 'talk' && busy !== 'recording') return
    const t = window.setTimeout(() => {
      if (cue.left <= 1) {
        if (cue.stage === 'prep') {
          setCue({ ...cue, stage: 'talk', left: 120 })
          void startRec(true)
        }
        return
      }
      setCue({ ...cue, left: cue.left - 1 })
    }, 1000)
    return () => clearTimeout(t)
  }, [cue, busy, startRec])

  // ------------------------------------------------------------------ session control
  const start = async () => {
    setError('')
    setBusy('starting')
    setMsgs([])
    setEnded(false)
    setReport(null)
    setCue(null)
    analyses.current.clear()
    settingsRef.current = {}
    setShowFb(mode !== 'ielts')
    const sett: Record<string, unknown> = mode === 'chat' ? { level, topic, scenario, partner: 'Emma' }
      : mode === 'coach' ? { level, topic, focus, target, lang, partner: 'Anna' }
      : { card_id: cardId || undefined, p1_topic: p1Topic || undefined }
    setPhase('session')
    // pre-synthesise backchannel fillers now: by the time the learner answers their first
    // question (several seconds away), they'll already be cached and instant to play
    for (const phrase of fillersFor(mode, lang)) warmClip(phrase, mode, player)
    try {
      setBusy('thinking')
      const r = await consume((on) => convStart(mode, sett, on))
      void afterSpeech(r.speech, false, null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy('idle')
      setPhase('setup')
    }
  }

  const finish = useCallback(async () => {
    player.stop()
    recorder.current?.cancel()
    recorder.current = null
    clearInterval(recTimer.current)
    setCue(null)
    const answered = msgsRef.current.filter((m) => m.role === 'user' && !m.pending)
    if (!answered.length) {
      setPhase('setup')
      return
    }
    setPhase('grading')
    await Promise.all(analyses.current.values())
    const all = msgsRef.current
    try {
      const rep = await convReport(mode, all.filter((m) => !m.pending)
        .map((m) => ({ role: m.role, text: m.text, part: m.part ?? null })), pronSummary(all))
      if (!alive.current) return
      setReport(rep)
      setPhase('report')
      const entry: SavedReport = {
        t: Date.now(), mode, overall: rep.overall, cefr: rep.cefr,
        bands: [rep.criteria.fluency.band, rep.criteria.lexical.band, rep.criteria.grammar.band, rep.criteria.pronunciation.band],
        label: mode === 'ielts' ? 'Thi thử IELTS' : mode === 'coach' ? `Học với giáo viên · ${FOCUS_LABEL[focus]}`
          : (SCENARIOS.find(([v]) => v === scenario)?.[1] ?? 'Trò chuyện'),
      }
      const list = [entry, ...loadReports()].slice(0, 50)
      try {
        localStorage.setItem(REPORT_KEY, JSON.stringify(list))
      } catch {
        /* ignore */
      }
      setSaved(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('session')
    }
  }, [player, mode, scenario, focus])

  const orbClick = async () => {
    if (busy === 'recording') {
      const s = await stopRec()
      if (s) void sendTurn({ samples: s })
      return
    }
    if (busy !== 'idle' || ended) return
    if (playing) player.stop() // barge in: interrupt the AI and answer right away
    if (cue?.stage === 'prep') {
      setCue({ ...cue, stage: 'talk', left: 120 })
      void startRec(true)
    } else {
      void startRec(cue?.stage === 'talk')
    }
  }

  const sendText = () => {
    const t = draft.trim()
    if (!t || busy !== 'idle' || ended) return
    setDraft('')
    player.stop()
    void sendTurn({ text: t })
  }

  const orbState: OrbState = busy === 'recording' ? 'user' : playing ? 'ai'
    : busy === 'transcribing' || busy === 'thinking' || busy === 'starting' ? 'think' : 'idle'
  const getLevel = useCallback(() => (busy === 'recording' ? micLevel.current : playing ? player.level() : 0), [busy, playing, player])
  const who = mode === 'ielts' ? `Giám khảo ${String((settingsRef.current.exam as { examiner?: string })?.examiner ?? '')}`
    : mode === 'coach' ? 'Cô Anna' : 'Emma'

  // ------------------------------------------------------------------ render
  if (phase === 'setup') {
    return (
      <div className="conv-setup">
        <div className="hero">
          <h1>Luyện nói cùng <span>AI</span></h1>
          <p className="muted">Nói tự nhiên như với người thật. AI trả lời bằng giọng nói ngay khi đang suy nghĩ, chấm phát âm từng âm và sửa lỗi cho bạn.</p>
        </div>
        {config && !config.configured && (
          <div className="alert">Tính năng trò chuyện AI chưa sẵn sàng. Vui lòng liên hệ quản trị viên để kích hoạt.</div>
        )}
        <div className="mode-grid">
          <button className={`card mode-card ${mode === 'ielts' ? 'active' : ''}`} onClick={() => setMode('ielts')}>
            <div className="mode-icon mi-exam">🎓</div>
            <h3>Thi thử IELTS Speaking</h3>
            <p className="muted small">Giám khảo AI hỏi đúng cấu trúc đề thật: Part 1 → Part 2 (thẻ đề, 1 phút chuẩn bị, nói 2 phút) → Part 3. Khoảng 12–15 phút, chấm band 4 tiêu chí.</p>
            <div className="mode-tags"><span>Part 1–3</span><span>Band score</span><span>~15 phút</span></div>
          </button>
          <button className={`card mode-card ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>
            <div className="mode-icon mi-chat">💬</div>
            <h3>Trò chuyện tự nhiên</h3>
            <p className="muted small">Nói chuyện thoải mái với Emma hoặc đóng vai tình huống thực tế. Nhận xét ngữ pháp, từ vựng và phát âm ngay sau mỗi câu.</p>
            <div className="mode-tags"><span>A2–C1</span><span>Nhập vai</span><span>Sửa lỗi tức thì</span></div>
          </button>
          <button className={`card mode-card ${mode === 'coach' ? 'active' : ''}`} onClick={() => setMode('coach')}>
            <div className="mode-icon mi-coach">👩‍🏫</div>
            <h3>Học với giáo viên IELTS</h3>
            <p className="muted small">Cô Anna hỏi, bạn trả lời, cô sửa từng lỗi, gợi ý từ vựng band cao và cách triển khai ý, rồi cho bạn nói lại đến khi mượt. Luyện tư duy, từ vựng và độ trôi chảy.</p>
            <div className="mode-tags"><span>Sửa lỗi 1-1</span><span>Nói lại</span><span>Tư duy & từ vựng</span></div>
          </button>
        </div>

        {mode === 'ielts' && bank && (
          <div className="card chat-options">
            <label className="topic-field">Đề Part 2 (cue card)
              <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">Ngẫu nhiên từ ngân hàng đề ({bank.part2.length} đề)</option>
                {bank.part2.map((c) => <option key={c.id} value={c.id}>{c.topic}</option>)}
              </select>
            </label>
            <label className="topic-field">Chủ đề Part 1 thứ hai
              <select value={p1Topic} onChange={(e) => setP1Topic(e.target.value)}>
                <option value="">Ngẫu nhiên</option>
                {bank.part1.filter((t) => !['Work or studies', 'Hometown', 'Home and accommodation'].includes(t.topic))
                  .map((t) => <option key={t.topic} value={t.topic}>{t.topic}</option>)}
              </select>
            </label>
            <p className="muted small bank-note">Bộ chủ đề IELTS thường gặp để luyện tập (không phải đề thi chính thức). Part 3 được hỏi theo đúng chủ đề của thẻ đề.</p>
          </div>
        )}

        {mode === 'coach' && (
          <div className="card chat-options">
            <label>Trọng tâm
              <div className="seg">
                {Object.entries(FOCUS_LABEL).map(([k, l]) => (
                  <button key={k} className={focus === k ? 'active' : ''} onClick={() => setFocus(k)}>{l}</button>
                ))}
              </div>
            </label>
            <label>Trình độ hiện tại
              <div className="seg">
                {['A2', 'B1', 'B2', 'C1'].map((l) => (
                  <button key={l} className={level === l ? 'active' : ''} onClick={() => setLevel(l)}>{l}</button>
                ))}
              </div>
            </label>
            <label>Band mục tiêu
              <div className="seg">
                {['6.0', '6.5', '7.0', '7.5', '8.0'].map((b) => (
                  <button key={b} className={target === b ? 'active' : ''} onClick={() => setTarget(b)}>{b}</button>
                ))}
              </div>
            </label>
            <label>Cô giảng bằng
              <div className="seg">
                <button className={lang === 'vi' ? 'active' : ''} onClick={() => setLang('vi')}>Tiếng Việt</button>
                <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
              </div>
            </label>
            <label className="topic-field">Chủ đề (tuỳ chọn)
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Để trống: cô chọn chủ đề IELTS phổ biến" />
              {bank && (
                <select value="" onChange={(e) => e.target.value && setTopic(e.target.value)}>
                  <option value="">Hoặc chọn từ ngân hàng đề…</option>
                  <optgroup label="Part 1">{bank.part1.map((t) => <option key={t.topic} value={t.topic}>{t.topic}</option>)}</optgroup>
                  <optgroup label="Part 2 (kèm Part 3)">{bank.part2.map((c) => <option key={c.id} value={c.topic}>{c.topic}</option>)}</optgroup>
                </select>
              )}
              <div className="chips">
                {COACH_TOPICS.map((t) => (
                  <button key={t} className={`chip-btn ${topic === t ? 'active' : ''}`} onClick={() => setTopic(topic === t ? '' : t)}>{t}</button>
                ))}
              </div>
            </label>
          </div>
        )}

        {mode === 'chat' && (
          <div className="card chat-options">
            <label>Trình độ
              <div className="seg">
                {['A2', 'B1', 'B2', 'C1'].map((l) => (
                  <button key={l} className={level === l ? 'active' : ''} onClick={() => setLevel(l)}>{l}</button>
                ))}
              </div>
            </label>
            <label>Tình huống
              <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {SCENARIOS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
              </select>
            </label>
            {!scenario && (
              <label className="topic-field">Chủ đề (tuỳ chọn)
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="VD: my favourite food" />
                <div className="chips">
                  {TOPICS.map((t) => (
                    <button key={t} className={`chip-btn ${topic === t ? 'active' : ''}`} onClick={() => setTopic(topic === t ? '' : t)}>{t}</button>
                  ))}
                </div>
              </label>
            )}
          </div>
        )}

        <div className="start-row">
          <button className="btn primary big" onClick={start} disabled={busy !== 'idle' || (config !== null && !config.configured)}>
            {busy !== 'idle' ? <><Spinner size={20} /> Đang chuẩn bị...</> : mode === 'ielts' ? 'Bắt đầu thi' : mode === 'coach' ? 'Vào lớp học' : 'Bắt đầu trò chuyện'}
          </button>
        </div>
        {error && <div className="alert">{error}</div>}

        {saved.length > 0 && (
          <div className="card">
            <h3>Các buổi gần đây</h3>
            <ul className="history">
              {saved.slice(0, 10).map((r) => (
                <li key={r.t} className="saved-row">
                  <span className={`pill ${bandStatus(r.overall)}`}>{r.overall.toFixed(1)}</span>
                  <span className="h-text">{r.label}{r.cefr ? ` · ${r.cefr}` : ''} <span className="muted small">(FC {r.bands[0]} · LR {r.bands[1]} · GRA {r.bands[2]} · P {r.bands[3]})</span></span>
                  <span className="muted small">{new Date(r.t).toLocaleString('vi-VN')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  if (phase === 'grading') {
    return (
      <div className="card grading">
        <div className="grading-orb" />
        <h3>Đang chấm điểm buổi {mode === 'ielts' ? 'thi' : mode === 'coach' ? 'học' : 'trò chuyện'}...</h3>
        <p className="muted small">Tổng hợp phát âm (CAPT) và đánh giá Fluency, Lexical Resource, Grammar, Pronunciation.</p>
      </div>
    )
  }

  if (phase === 'report' && report) {
    return <ReportView report={report} mode={mode} msgs={msgs}
      onAgain={() => setPhase('setup')} onPractice={onPractice} player={player} playing={playing} />
  }

  const selMsg = wordSel ? msgs.find((m) => m.id === wordSel.msgId) : null
  const selPron = selMsg?.analysis?.pron ? rescore(selMsg.analysis.pron, strictness) : null
  const selWord = selPron && wordSel ? selPron.words[wordSel.idx] : null
  const waiting = busy === 'transcribing' || busy === 'thinking' || busy === 'starting'

  return (
    <div className="conv">
      <div className="conv-bar">
        <div className="conv-title">
          <Avatar mode={mode} talking={!!playing} />
          <div>
            <b>{who}</b>
            <div className="muted small">{playing ? 'đang nói…' : waiting ? 'đang nghe & suy nghĩ…' : mode === 'ielts' ? 'IELTS Speaking Test'
              : mode === 'coach' ? `Giáo viên IELTS · ${FOCUS_LABEL[focus]} · mục tiêu ${target}` : `Trò chuyện · ${level}`}</div>
          </div>
        </div>
        {mode === 'ielts' && (
          <div className="stepper">
            {[1, 2, 3].map((p) => (
              <span key={p} className={`step ${part === p ? 'active' : part && part > p ? 'done' : ''}`}><i>{p}</i>Part {p}</span>
            ))}
          </div>
        )}
        <div className="conv-actions">
          <label className="auto-stop small"><input type="checkbox" checked={showFb} onChange={(e) => setShowFb(e.target.checked)} /> Nhận xét</label>
          <label className="auto-stop small"><input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} /> Rảnh tay</label>
          <button className="btn primary sm" onClick={() => void finish()}>Kết thúc & chấm</button>
        </div>
      </div>

      <div className="chat" ref={listRef}>
        {msgs.map((m) => m.role === 'assistant'
          ? <AiBubble key={m.id} m={m} mode={mode} playing={playing === m.id}
              onReplay={() => void player.play(m.id, m.text, mode)} onStop={() => player.stop()} />
          : <UserBubble key={m.id} m={m} strictness={strictness} showFb={showFb}
              onWord={(idx) => setWordSel({ msgId: m.id, idx })} onPractice={onPractice} />)}
        {waiting && !msgs.some((m) => m.streaming) && (
          <div className="bubble-row ai">
            <Avatar mode={mode} talking={false} />
            <div className="bubble ai typing"><span /><span /><span /></div>
          </div>
        )}
        {cue && <CueCardView cue={cue} />}
        {ended && (
          <div className="end-box">
            <div className="end-icon">✓</div>
            <p>Buổi {mode === 'ielts' ? 'thi' : 'trò chuyện'} đã kết thúc.</p>
            <button className="btn primary" onClick={() => void finish()}>Xem kết quả chấm điểm</button>
          </div>
        )}
      </div>

      {error && <div className="alert conv-alert">{error}</div>}

      <div className="dock">
        <div className="dock-status">
          {busy === 'recording'
            ? <><span className="rec-dot" />{speaking ? `Đang nghe · ${fmt(elapsed)} · ngừng nói để gửi` : `Mời bạn nói · ${fmt(elapsed)}`}</>
            : busy === 'transcribing' ? 'Đang chuyển giọng nói thành chữ…'
            : busy === 'thinking' || busy === 'starting' ? `${who} đang suy nghĩ…`
            : playing ? `${who} đang nói · chạm vào micro để ngắt lời`
            : ended ? 'Đã kết thúc' : 'Chạm vào micro để trả lời'}
        </div>
        <div className="dock-row">
          <button className={`dock-side ${typing ? 'on' : ''}`} onClick={() => setTyping(!typing)} aria-label="Gõ phím" title="Gõ phím">
            <KeyboardIcon />
          </button>
          <VoiceOrb state={orbState} getLevel={getLevel} disabled={waiting || ended} onClick={() => void orbClick()}>
            {busy === 'recording' ? <StopIcon size={26} /> : waiting ? <Spinner size={26} /> : <MicIcon size={28} />}
          </VoiceOrb>
          <button className="dock-side" onClick={() => playing && player.stop()} disabled={!playing} aria-label="Dừng giọng AI" title="Dừng giọng AI">
            <StopIcon size={18} />
          </button>
        </div>
        {typing && (
          <div className="type-row">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Gõ câu trả lời và nhấn Enter…" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') sendText() }} disabled={busy !== 'idle' || ended} />
            <button className="btn primary" onClick={sendText} disabled={!draft.trim() || busy !== 'idle' || ended} aria-label="Gửi"><SendIcon /></button>
          </div>
        )}
      </div>

      {selWord && selMsg && (
        <div className="modal" onClick={() => setWordSel(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setWordSel(null)} aria-label="Đóng">×</button>
            <WordDetail word={selWord} accent={accent} samples={selMsg.samples ?? null} text={selMsg.text} />
          </div>
        </div>
      )}
    </div>
  )
}

function fmt(sec: number) {
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Avatar({ mode, talking }: { mode: Mode; talking: boolean }) {
  return <span className={`avatar av-${mode} ${talking ? 'talking' : ''}`}>{mode === 'ielts' ? 'E' : mode === 'coach' ? 'A' : 'Em'}</span>
}

// ---------------------------------------------------------------------- voice orb
type OrbState = 'idle' | 'user' | 'ai' | 'think'

/** Mic button wrapped in a canvas ring of bars that dances with the live audio level:
 *  the learner's microphone while recording, the AI's voice while it speaks. */
function VoiceOrb({ state, getLevel, disabled, onClick, children }: {
  state: OrbState; getLevel: () => number; disabled: boolean; onClick: () => void; children: ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const levelRef = useRef(getLevel)
  stateRef.current = state
  levelRef.current = getLevel

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = 168
    cv.width = size * dpr
    cv.height = size * dpr
    ctx.scale(dpr, dpr)
    const N = 56
    const bars = new Float32Array(N)
    let smooth = 0, t = 0, raf = 0
    const css = getComputedStyle(cv)
    const draw = () => {
      t += 1
      const st = stateRef.current
      const lv = st === 'user' || st === 'ai' ? levelRef.current() : 0
      smooth += (lv - smooth) * 0.25
      ctx.clearRect(0, 0, size, size)
      const cx = size / 2, cy = size / 2, r0 = 46
      const c1 = css.getPropertyValue(st === 'user' ? '--orb-user1' : '--orb-1').trim() || '#6d5ef6'
      const c2 = css.getPropertyValue(st === 'user' ? '--orb-user2' : '--orb-2').trim() || '#17c3b2'
      const grad = ctx.createLinearGradient(0, 0, size, size)
      grad.addColorStop(0, c1)
      grad.addColorStop(1, c2)
      // soft glow disc
      const glow = ctx.createRadialGradient(cx, cy, r0 * .6, cx, cy, r0 + 30 + smooth * 18)
      glow.addColorStop(0, `${c1}55`)
      glow.addColorStop(1, `${c1}00`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(cx, cy, r0 + 34, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = grad
      ctx.lineCap = 'round'
      ctx.lineWidth = 3
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2
        let target: number
        if (st === 'think') {
          // a light travelling around the ring
          const d = ((i - (t * .6) % N) + N) % N
          target = Math.max(0, 1 - d / 10) * 14 + 2
        } else if (st === 'idle') {
          target = 2 + Math.sin(t / 40 + i / 3) * 1.2 + 1.2
        } else {
          const wobble = .55 + .45 * Math.sin(i * 1.7 + t / 5) * Math.cos(i * .6 - t / 9)
          target = 3 + smooth * 30 * Math.abs(wobble)
        }
        bars[i] += (target - bars[i]) * 0.3
        const r1 = r0 + 6, r2 = r1 + bars[i]
        ctx.globalAlpha = st === 'idle' ? .45 : .9
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className={`orb ${state}`}>
      <canvas ref={canvas} style={{ width: 168, height: 168 }} aria-hidden />
      <button className="orb-btn" onClick={onClick} disabled={disabled} aria-label="Micro">{children}</button>
    </div>
  )
}

// ---------------------------------------------------------------------- bubbles
function AiBubble({ m, mode, playing, onReplay, onStop }: { m: Msg; mode: Mode; playing: boolean; onReplay: () => void; onStop: () => void }) {
  return (
    <div className="bubble-row ai">
      <Avatar mode={mode} talking={playing} />
      <div className={`bubble ai ${m.streaming ? 'streaming' : ''}`}>
        {m.part && mode === 'ielts' && <span className="part-tag">Part {m.part}</span>}
        {mode === 'coach' && m.stage === 'retry' && !m.streaming && <span className="part-tag retry-tag">↻ Hãy nói lại câu trả lời</span>}
        <div className="ai-text">{m.text}{m.streaming && <span className="caret" />}</div>
        {!m.streaming && (
          <div className="bubble-tools">
            {playing
              ? <button className="icon-btn" onClick={onStop} aria-label="Dừng"><span className="eq"><i /><i /><i /><i /></span></button>
              : <button className="icon-btn" onClick={onReplay} aria-label="Nghe lại"><SpeakerIcon size={16} /></button>}
          </div>
        )}
      </div>
    </div>
  )
}

function UserBubble({ m, strictness, showFb, onWord, onPractice }: {
  m: Msg; strictness: Strictness; showFb: boolean; onWord: (idx: number) => void; onPractice: (t: string) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(showFb), [showFb])
  const pron = m.analysis?.pron ? rescore(m.analysis.pron, strictness) : null
  const fb = m.analysis?.feedback

  let body: ReactNode = m.text || '…'
  if (pron) {
    const pieces: ReactNode[] = []
    let cur = 0
    pron.words.forEach((w, i) => {
      if (w.start_char > cur) pieces.push(<span key={`g${i}`}>{m.text.slice(cur, w.start_char)}</span>)
      const label = m.text.slice(w.start_char, w.end_char)
      pieces.push(w.oov
        ? <span key={i}>{label}</span>
        : <button key={i} className={`cword ${w.score != null ? statusOf(w.score) : ''}`} onClick={() => onWord(i)}>
            <ColoredWord word={w} label={label} />
          </button>)
      cur = w.end_char
    })
    if (cur < m.text.length) pieces.push(<span key="tail">{m.text.slice(cur)}</span>)
    body = pieces
  }

  return (
    <div className="bubble-row user">
      <div className={`bubble user ${m.pending ? 'pending' : ''}`}>
        <div className="user-text">{m.pending && !m.text ? <span className="listening"><i /><i /><i /> Đang nhận dạng giọng nói</span> : body}</div>
        {!m.pending && (
          <div className="bubble-meta">
            {pron && <span className={`pill ${statusOf(pron.overall)}`} title="Điểm phát âm (CAPT)">Phát âm {Math.round(pron.overall)}%</span>}
            {pron?.wpm ? <span className="muted small">{pron.wpm} từ/phút</span> : null}
            {m.typed && <span className="muted small">Đã gõ phím</span>}
            {!m.analysis && !m.analysisError && <span className="muted small analysing"><Spinner size={12} /> đang phân tích</span>}
            {m.analysisError && <span className="muted small">Lỗi phân tích: {m.analysisError}</span>}
            {fb && <button className="btn link sm" onClick={() => setOpen(!open)}>{open ? 'Ẩn nhận xét' : 'Xem nhận xét'}</button>}
          </div>
        )}
        {open && fb && (
          <div className="feedback">
            {fb.comment_vi && <p className="fb-comment">{fb.comment_vi}</p>}
            {fb.corrections.length > 0 && (
              <ul className="fb-corr">
                {fb.corrections.map((c, i) => (
                  <li key={i}>
                    <span className="wrong">{c.original}</span> → <span className="right">{c.fixed}</span>
                    {c.type && <span className="fb-type">{c.type}</span>}
                    <div className="muted small">{c.explain_vi}</div>
                  </li>
                ))}
              </ul>
            )}
            {fb.improved && (
              <div className="fb-improved">
                <div className="fb-label">Cách nói hay hơn</div>
                <p>{fb.improved}</p>
                <button className="btn link sm" onClick={() => onPractice(fb.improved)}>Luyện phát âm câu này →</button>
              </div>
            )}
            {fb.vocab?.length > 0 && (
              <div className="fb-vocab">
                {fb.vocab.map((v, i) => (
                  <div key={i} className="vocab-chip" title={v.example}><b>{v.phrase}</b> · {v.meaning_vi}<div className="muted small">{v.example}</div></div>
                ))}
              </div>
            )}
            {m.analysis?.errors.map((e, i) => <div key={i} className="muted small">{e}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

function CueCardView({ cue }: { cue: { card: CueCard; stage: 'prep' | 'talk'; left: number } }) {
  const total = cue.stage === 'prep' ? 60 : 120
  return (
    <div className="cue-card">
      <div className="cue-head">
        <span className="part-tag">Part 2 · Cue card</span>
        <span className={`cue-timer ${cue.stage}`}>
          {cue.stage === 'prep' ? 'Chuẩn bị' : 'Đang nói'} · {fmt(cue.left)}
        </span>
      </div>
      <h3>{cue.card.topic}</h3>
      <p className="muted small">You should say:</p>
      <ul>{cue.card.points.map((p) => <li key={p}>{p}</li>)}</ul>
      <p>{cue.card.closing}</p>
      <div className="cue-progress"><span style={{ width: `${(1 - cue.left / total) * 100}%` }} /></div>
      <p className="muted small">
        {cue.stage === 'prep'
          ? 'Ghi chú ý chính ra giấy. Micro tự bật sau 1 phút, hoặc chạm micro để nói ngay.'
          : 'Hãy nói liên tục 1–2 phút. Ngừng nói khoảng 4 giây hoặc chạm micro để kết thúc.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------- report
function pronSummary(msgs: Msg[]) {
  const phones: Record<string, { sum: number; n: number }> = {}
  const weakWords = new Map<string, number>()
  let sum = 0, n = 0, wpmSum = 0, wpmN = 0, pauses = 0, words = 0, answers = 0, audio = 0
  for (const m of msgs) {
    if (m.role !== 'user' || m.pending) continue
    answers++
    words += m.text.split(/\s+/).filter(Boolean).length
    const p = m.analysis?.pron
    if (!p) continue
    audio++
    const r: Assessment = rescore(p, 'normal')
    for (const w of r.words) {
      if (w.oov) continue
      if ((w.score ?? 100) < 70) weakWords.set(w.text.toLowerCase(), Math.round(w.score ?? 0))
      for (const ph of w.phones) {
        const s = (phones[ph.arpa] ??= { sum: 0, n: 0 })
        s.sum += ph.score ?? 0
        s.n++
        sum += ph.score ?? 0
        n++
      }
    }
    if (p.wpm) {
      wpmSum += p.wpm
      wpmN++
    }
    pauses += p.pauses.length
  }
  const weakest = Object.entries(phones).filter(([, v]) => v.n >= 3)
    .map(([arpa, v]) => ({ phoneme: PHONEMES[arpa]?.ipa ?? arpa, avg: Math.round(v.sum / v.n), count: v.n }))
    .sort((a, b) => a.avg - b.avg).slice(0, 6)
  return {
    avg_score: n ? Math.round((sum / n) * 10) / 10 : null,
    weakest_phonemes: weakest,
    weak_words: [...weakWords.entries()].slice(0, 12).map(([w, s]) => ({ word: w, score: s })),
    avg_words_per_minute: wpmN ? Math.round(wpmSum / wpmN) : null,
    long_pauses: pauses,
    answers,
    answers_with_audio: audio,
    avg_answer_words: answers ? Math.round(words / answers) : 0,
  }
}

const CRIT: [keyof Report['criteria'], string, string][] = [
  ['fluency', 'Fluency & Coherence', 'Độ trôi chảy & mạch lạc'],
  ['lexical', 'Lexical Resource', 'Vốn từ vựng'],
  ['grammar', 'Grammatical Range & Accuracy', 'Ngữ pháp'],
  ['pronunciation', 'Pronunciation', 'Phát âm'],
]

function ReportView({ report, mode, msgs, onAgain, onPractice, player, playing }: {
  report: Report; mode: Mode; msgs: Msg[]; onAgain: () => void
  onPractice: (t: string) => void; player: VoicePlayer; playing: string | null
}) {
  const summary = useMemo(() => pronSummary(msgs), [msgs])
  return (
    <div className="report">
      <div className="card report-head">
        <div className={`band-ring ${bandStatus(report.overall)}`} style={{ '--p': report.overall / 9 } as CSSProperties}>
          <div><b>{report.overall.toFixed(1)}</b><span>Overall band</span></div>
        </div>
        <div className="report-sum">
          <h2>{mode === 'ielts' ? 'Kết quả thi thử IELTS Speaking' : mode === 'coach' ? 'Đánh giá buổi học với giáo viên' : 'Đánh giá buổi trò chuyện'}</h2>
          {report.cefr && <span className="pill good">CEFR {report.cefr}</span>}
          <p>{report.summary_vi}</p>
          <span className="muted small">{new Date().toLocaleString('vi-VN')}</span>
        </div>
        <button className="btn ghost no-print report-print" onClick={() => printReport(mode)}><PrintIcon /> Xuất PDF</button>
      </div>

      <div className="crit-grid">
        {CRIT.map(([k, en, vi]) => (
          <div key={k} className={`card crit ${bandStatus(report.criteria[k].band)}`}>
            <div className="crit-top">
              <div><b>{en}</b><div className="muted small">{vi}</div></div>
              <span className="crit-band">{report.criteria[k].band.toFixed(1)}</span>
            </div>
            <div className="crit-bar"><span style={{ width: `${(report.criteria[k].band / 9) * 100}%` }} /></div>
            <p className="small">{report.criteria[k].comment_vi}</p>
          </div>
        ))}
      </div>

      <div className="report-cols">
        <div className="card list-card good"><h3>Điểm mạnh</h3><ul>{report.strengths_vi.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        <div className="card list-card warn"><h3>Cần cải thiện</h3><ul>{report.weaknesses_vi.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      </div>
      <div className="card"><h3>Kế hoạch luyện tập</h3><ol className="plan">{report.action_plan_vi.map((s, i) => <li key={i}>{s}</li>)}</ol></div>

      <div className="card">
        <h3>Phát âm (chấm bằng CAPT trên máy)</h3>
        <div className="pron-stats">
          <div><span className="muted small">Điểm âm vị trung bình</span><b>{summary.avg_score ?? '-'}%</b></div>
          <div><span className="muted small">Tốc độ nói TB</span><b>{summary.avg_words_per_minute ?? '-'} <small>từ/phút</small></b></div>
          <div><span className="muted small">Độ dài câu trả lời TB</span><b>{summary.avg_answer_words} <small>từ</small></b></div>
          <div><span className="muted small">Ngắt nghỉ dài</span><b>{summary.long_pauses}</b></div>
        </div>
        {summary.weakest_phonemes.length > 0 && (
          <div className="chips">
            <span className="muted small">Âm yếu nhất:</span>
            {summary.weakest_phonemes.map((p) => <span key={p.phoneme} className={`chip ${statusOf(p.avg)}`}>/{p.phoneme}/ {p.avg}</span>)}
          </div>
        )}
        {summary.weak_words.length > 0 && (
          <div className="chips">
            <span className="muted small">Từ cần luyện:</span>
            {summary.weak_words.map((w) => (
              <button key={w.word} className="chip-btn" onClick={() => onPractice(w.word)}>{w.word} · {w.score}</button>
            ))}
          </div>
        )}
      </div>

      {report.key_corrections?.length > 0 && (
        <div className="card">
          <h3>Lỗi quan trọng cần sửa</h3>
          <ul className="fb-corr">
            {report.key_corrections.map((c, i) => (
              <li key={i}><span className="wrong">{c.original}</span> → <span className="right">{c.fixed}</span>
                <div className="muted small">{c.explain_vi}</div></li>
            ))}
          </ul>
        </div>
      )}

      {report.sample_answer?.answer && (
        <div className="card sample">
          <h3>Câu trả lời mẫu (band 8)</h3>
          <p className="muted small">{report.sample_answer.question}</p>
          <p>{report.sample_answer.answer}</p>
          <div className="listen-row left no-print">
            <button className="btn ghost sm" onClick={() => playing === 'sample' ? player.stop() : void player.play('sample', report.sample_answer!.answer, mode)}>
              {playing === 'sample' ? <><StopIcon size={16} /> Dừng</> : <><PlayIcon size={16} /> Nghe mẫu</>}
            </button>
            <button className="btn ghost sm" onClick={() => onPractice(report.sample_answer!.answer)}>Luyện phát âm câu này</button>
          </div>
        </div>
      )}

      <details className="card transcript" open={false}>
        <summary><h3>Toàn bộ nội dung buổi luyện</h3></summary>
        <div className="transcript-body">
          {msgs.filter((m) => !m.pending && m.text).map((m) => (
            <p key={m.id} className={m.role}><b>{m.role === 'user' ? 'Bạn' : mode === 'ielts' ? 'Giám khảo' : mode === 'coach' ? 'Giáo viên' : 'Emma'}:</b> {m.text}</p>
          ))}
        </div>
      </details>

      <div className="start-row no-print">
        <button className="btn ghost big" onClick={() => printReport(mode)}><PrintIcon /> Xuất PDF</button>
        <button className="btn primary big" onClick={onAgain}>Luyện buổi mới</button>
      </div>
    </div>
  )
}

/** Browser print dialog -> "Save as PDF"; the print stylesheet keeps only the report. */
function printReport(mode: Mode) {
  const prev = document.title
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  document.title = `Bao-cao-${mode === 'ielts' ? 'thi-thu-IELTS' : mode === 'coach' ? 'hoc-voi-giao-vien' : 'tro-chuyen'}-${stamp}`
  const details = document.querySelectorAll<HTMLDetailsElement>('.report details')
  details.forEach((el) => (el.open = true))
  window.print()
  document.title = prev
}

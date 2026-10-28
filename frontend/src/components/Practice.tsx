import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { analyze, assess, shadowCompare, type Assessment, type Prosody, type Word } from '../lib/api'
import { VoicePlayer } from '../lib/voice'
import { ProsodyCard } from './ProsodyCard'
import { rescore, type Strictness } from '../lib/scoring'
import { playSamples, Recorder } from '../lib/audio'
import { speak, type Accent } from '../lib/tts'
import { bestScore, saveAttempt } from '../lib/storage'
import { phonemeInfo } from '../data/phonemes'
import { ScoreRing, statusOf } from './ScoreRing'
import { ColoredWord, lettersOf } from './ColoredWord'
import { ChevronLeft, ChevronRight, MicIcon, PlayIcon, SpeakerIcon, Spinner, StopIcon, TurtleIcon } from './Icons'

const MAX_SEC = 30

type RecState = 'idle' | 'recording' | 'processing'

interface Props {
  text: string
  accent: Accent
  strictness: Strictness
  position?: string
  onPrev?: () => void
  onNext?: () => void
  onScored?: () => void
  /** shadowing: the AI reads the sentence, then the mic opens to imitate it; intonation is scored too */
  shadow?: boolean
}

export function Practice({ text, accent, strictness, position, onPrev, onNext, onScored, shadow = false }: Props) {
  const [words, setWords] = useState<Word[]>([])
  const [raw, setResult] = useState<Assessment | null>(null)
  // scores are re-derived from raw log-odds, so changing strictness re-colours instantly
  const result = useMemo(() => (raw ? rescore(raw, strictness) : null), [raw, strictness])
  const [samples, setSamples] = useState<Float32Array | null>(null)
  const [rec, setRec] = useState<RecState>('idle')
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  const [best, setBest] = useState<number | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [autoStop, setAutoStop] = useState(() => {
    try {
      return localStorage.getItem('auto-stop') !== '0'
    } catch {
      return true
    }
  })
  const recorder = useRef<Recorder | null>(null)
  const timer = useRef(0)
  const [prosody, setProsody] = useState<Prosody | null>(null)
  const [aiPlaying, setAiPlaying] = useState(false)
  const player = useMemo(() => new VoicePlayer(), [])
  useEffect(() => {
    player.onChange = (id) => setAiPlaying(id !== null)
    return () => player.stop()
  }, [player])

  const toggleAutoStop = (v: boolean) => {
    setAutoStop(v)
    try {
      localStorage.setItem('auto-stop', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    setResult(null)
    setSamples(null)
    setProsody(null)
    player.stop()
    setSel(null)
    setError('')
    setBest(bestScore(text))
    analyze(text).then((r) => setWords(r.words)).catch((e) => setError(e.message))
    return () => recorder.current?.cancel()
  }, [text, player])

  const stop = useCallback(async () => {
    const r = recorder.current
    if (!r) return
    recorder.current = null
    clearInterval(timer.current)
    setRec('processing')
    setLevel(0)
    setSpeaking(false)
    try {
      const s = await r.stop()
      setSamples(s)
      // shadowing: intonation analysis runs in parallel with the pronunciation scoring
      const pros = shadow ? shadowCompare(text, s).catch(() => null) : null
      const rawRes = await assess(text, s)
      if (pros) setProsody(await pros)
      setResult(rawRes)
      const res = rescore(rawRes, strictness)
      saveAttempt(text, res)
      setBest(bestScore(text))
      onScored?.()
      // open the weakest word straight away
      const scored = res.words.map((w, i) => [w.score ?? 101, i] as const).filter(([s]) => s <= 100)
      const worst = scored.sort((a, b) => a[0] - b[0])[0]
      setSel(worst && worst[0] < 80 ? worst[1] : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRec('idle')
    }
  }, [text, onScored, strictness, shadow])

  const start = useCallback(async () => {
    setError('')
    speechSynthesis.cancel()
    const r = new Recorder()
    // single words end quickly; sentences need room for natural pauses between words
    const nWords = text.trim().split(/\s+/).length
    const vad = autoStop || shadow ? {
      silenceMs: nWords <= 1 ? 700 : 1200,
      minUtterMs: nWords <= 2 ? 240 : 500,
      onFalseStart: () => setSpeaking(false),
      noSpeechMs: 8000,
      onSpeechStart: () => setSpeaking(true),
      onSpeechEnd: () => void stop(),
      onNoSpeech: () => {
        if (recorder.current !== r) return
        recorder.current = null
        clearInterval(timer.current)
        r.cancel()
        setRec('idle')
        setLevel(0)
        setError('Không phát hiện giọng nói trong 8 giây. Hãy kiểm tra micro và thử lại.')
      },
    } : undefined
    setSpeaking(false)
    try {
      await r.start(setLevel, vad, { echoCancellation: shadow })
    } catch {
      setError('Không truy cập được micro. Hãy cho phép quyền micro trong trình duyệt.')
      return
    }
    recorder.current = r
    setRec('recording')
    setElapsed(0)
    const t0 = Date.now()
    timer.current = window.setInterval(() => {
      const sec = (Date.now() - t0) / 1000
      setElapsed(sec)
      if (sec >= MAX_SEC) void stop()
    }, 100)
  }, [stop, text, autoStop])

  /** Shadowing round: listen to the AI voice, then imitate it straight away. */
  const shadowRound = useCallback(async () => {
    setError('')
    setProsody(null)
    try {
      const done = await player.play('ref', text, 'chat')
      if (done) await start()
    } catch (e) {
      setError(`Không phát được giọng mẫu: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [player, text, start])

  const toggle = useCallback(() => {
    if (rec === 'recording') void stop()
    else if (aiPlaying) player.stop()
    else if (rec === 'idle') void (shadow ? shadowRound() : start())
  }, [rec, start, stop, shadow, shadowRound, aiPlaying, player])

  // Space = record / stop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const shown = result?.words ?? words
  const selWord = sel !== null ? shown[sel] : null

  // rebuild the sentence keeping punctuation between words
  const pieces: ReactNode[] = []
  let cursor = 0
  shown.forEach((w, i) => {
    if (w.start_char > cursor) pieces.push(<span key={`g${i}`} className="gap">{text.slice(cursor, w.start_char)}</span>)
    const st = w.score != null ? statusOf(w.score) : ''
    pieces.push(
      <button key={i} className={`word ${st} ${sel === i ? 'sel' : ''} ${w.oov ? 'oov' : ''}`}
        onClick={() => setSel(sel === i ? null : i)} disabled={w.oov}
        title={w.oov ? 'Từ không có trong từ điển, không chấm điểm' : undefined}>
        <span className="w-text"><ColoredWord word={w} label={text.slice(w.start_char, w.end_char)} /></span>
        <span className="w-ipa">{w.ipa ? `/${w.ipa}/` : ' '}</span>
      </button>,
    )
    cursor = w.end_char
  })
  if (cursor < text.length) pieces.push(<span key="tail" className="gap">{text.slice(cursor)}</span>)

  return (
    <div className="practice">
      <div className="card prompt-card">
        <div className="prompt-top">
          {position && <span className="muted small">{position}</span>}
          {best !== null && <span className={`pill ${statusOf(best)}`}>Tốt nhất: {Math.round(best)}%</span>}
        </div>
        <div className="sentence">{pieces}</div>
        <div className="listen-row">
          {shadow
            ? <button className="btn ghost" onClick={() => (aiPlaying ? player.stop() : void player.play('ref', text, 'chat'))}>
                {aiPlaying ? <StopIcon size={18} /> : <SpeakerIcon />} {aiPlaying ? 'Dừng' : 'Nghe giọng AI'}
              </button>
            : <button className="btn ghost" onClick={() => speak(text, accent, 0.95)}><SpeakerIcon /> Nghe mẫu</button>}
          <button className="btn ghost" onClick={() => speak(text, accent, 0.6)}><TurtleIcon /> Chậm</button>
          {samples && (
            <button className="btn ghost" onClick={() => playSamples(samples)}><PlayIcon /> Giọng của bạn</button>
          )}
        </div>
      </div>

      <div className="mic-row">
        {onPrev ? <button className="btn round" onClick={onPrev} aria-label="Câu trước"><ChevronLeft /></button> : <span />}
        <div className="mic-wrap">
          <button className={`mic ${rec} ${aiPlaying ? 'ai-playing' : ''}`} onClick={toggle} disabled={rec === 'processing'}
            style={{ '--lvl': level } as CSSProperties} aria-label="Ghi âm">
            {rec === 'recording' ? <StopIcon /> : rec === 'processing' ? <Spinner /> : aiPlaying ? <SpeakerIcon size={30} /> : <MicIcon />}
          </button>
          <div className="mic-hint">
            {rec === 'recording'
              ? autoStop
                ? speaking ? `Đang nghe... ${elapsed.toFixed(1)}s (ngừng nói để tự dừng)` : 'Mời bạn nói...'
                : `Đang nghe... ${elapsed.toFixed(1)}s (bấm để dừng)`
              : rec === 'processing' ? 'Đang chấm điểm...'
              : aiPlaying ? 'Nghe kỹ giọng AI... micro sẽ tự bật để bạn nhại lại'
              : shadow ? 'Bấm (hoặc Space): nghe AI đọc rồi nhại lại ngay'
              : 'Bấm micro hoặc phím Space để nói'}
          </div>
          {!shadow && <label className="auto-stop small">
            <input type="checkbox" checked={autoStop} disabled={rec !== 'idle'}
              onChange={(e) => toggleAutoStop(e.target.checked)} />
            Tự dừng khi nói xong
          </label>}
        </div>
        {onNext ? <button className="btn round" onClick={onNext} aria-label="Câu tiếp"><ChevronRight /></button> : <span />}
      </div>

      {error && <div className="alert">{error}</div>}
      {result?.warning && <div className="alert warn-alert">{result.warning}</div>}

      {result && (
        <div className="card result-card">
          <div className="result-head">
            <ScoreRing score={result.overall} />
            <div className="result-meta">
              <h3>{verdict(result.overall)}</h3>
              <div className="legend">
                <span className="dot good" /> Tốt <span className="dot warn" /> Gần đúng <span className="dot bad" /> Cần sửa
              </div>
              <div className="muted small">
                {result.wpm ? `Tốc độ: ${result.wpm} từ/phút` : ''}
                {result.pauses.length ? `${result.wpm ? ' · ' : ''}Ngắt dài sau: ${result.pauses.map((p) => `"${p.after}" (${p.sec}s)`).join(', ')}` : ''}
              </div>
              <div className="heard small">
                <span className="muted">Bạn đã phát âm thành:</span> <code>/{result.heard_ipa}/</code>
              </div>
            </div>
          </div>
          {!selWord && <p className="muted small center">Bấm vào từng từ để xem chi tiết từng âm.</p>}
        </div>
      )}

      {prosody && <ProsodyCard p={prosody} />}

      {selWord && selWord.score != null && (
        <WordDetail word={selWord} accent={accent} samples={samples} text={text} />
      )}
    </div>
  )
}

function verdict(s: number) {
  if (s >= 90) return 'Xuất sắc! Phát âm rất chuẩn.'
  if (s >= 80) return 'Tốt lắm! Chỉ còn vài điểm nhỏ.'
  if (s >= 65) return 'Khá ổn, hãy sửa các âm màu cam/đỏ.'
  if (s >= 50) return 'Cần luyện thêm một chút.'
  return 'Hãy nghe mẫu và thử lại chậm hơn.'
}

export function WordDetail({ word, accent, samples, text }: { word: Word; accent: Accent; samples: Float32Array | null; text: string }) {
  const label = text.slice(word.start_char, word.end_char)
  const [open, setOpen] = useState<number | null>(() => {
    const i = word.phones.findIndex((p) => (p.score ?? 100) < 80)
    return i >= 0 ? i : null
  })
  useEffect(() => {
    const i = word.phones.findIndex((p) => (p.score ?? 100) < 80)
    setOpen(i >= 0 ? i : null)
  }, [word])

  return (
    <div className="card detail-card">
      <div className="detail-head">
        <div>
          <div className="detail-word"><ColoredWord word={word} label={label} /></div>
          <div className="detail-ipa">/{word.ipa}/</div>
        </div>
        <div className="detail-actions">
          <button className="btn ghost sm" onClick={() => speak(label, accent, 0.8)}><SpeakerIcon size={18} /> Mẫu</button>
          {samples && word.start !== undefined && (
            <button className="btn ghost sm" onClick={() => playSamples(samples, word.start, word.end)}>
              <PlayIcon size={18} /> Bạn đọc
            </button>
          )}
          <ScoreRing score={word.score ?? 0} size={64} />
        </div>
      </div>

      <div className="phones">
        {word.phones.map((p, i) => {
          const st = p.status ?? 'good'
          const info = phonemeInfo(p.arpa)
          return (
            <div key={i} className={`phone-row ${st} ${open === i ? 'open' : ''}`}>
              <button className="phone-main" onClick={() => setOpen(open === i ? null : i)}>
                <span className={`chip ${st}`}>/{p.ipa}/<small className="chip-letters">{lettersOf(word, i)}</small></span>
                <span className="bar"><span style={{ width: `${p.score}%` }} /></span>
                <span className="phone-score">{Math.round(p.score ?? 0)}</span>
                <span className="phone-msg">{message(p.status, p.heard, p.ipa)}</span>
              </button>
              {open === i && info && (
                <div className="phone-tip">
                  <div><b>/{info.ipa}/</b> như trong <i>{info.example}</i></div>
                  <p>{info.tip}</p>
                  <button className="btn link" onClick={() => speak(info.example.split(',')[0], accent, 0.7)}>
                    <SpeakerIcon size={16} /> Nghe ví dụ
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function message(status: string | undefined, heard: string | null | undefined, ipa: string) {
  if (status === 'good') return 'Chuẩn'
  if (heard === '-') return 'Bị bỏ sót (chưa phát âm)'
  if (heard) return `Nghe giống /${heard}/ thay vì /${ipa}/`
  return status === 'warn' ? 'Gần đúng, chưa rõ' : 'Chưa đúng'
}

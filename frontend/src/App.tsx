import { useEffect, useState } from 'react'
import { LESSONS } from './data/lessons'
import { health } from './lib/api'
import type { Accent } from './lib/tts'
import { STRICTNESS_LABEL, type Strictness } from './lib/scoring'
import { bestScore } from './lib/storage'
import { Practice } from './components/Practice'
import { Progress } from './components/Progress'
import { Conversation } from './components/Conversation'
import { Shadowing } from './components/Shadowing'
import { statusOf } from './components/ScoreRing'
import { BookIcon, ChartIcon, ChatIcon, ChevronLeft, PenIcon, WaveIcon } from './components/Icons'

type View = 'lessons' | 'custom' | 'shadow' | 'conv' | 'progress'

function usePersisted<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : init
    } catch {
      return init
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }, [key, v])
  return [v, setV] as const
}

export default function App() {
  const [view, setView] = usePersisted<View>('view', 'lessons')
  const [accent, setAccent] = usePersisted<Accent>('accent', 'en-US')
  const [strictness, setStrictness] = usePersisted<Strictness>('strictness', 'normal')
  const [lessonId, setLessonId] = useState<string | null>(null)
  const [idx, setIdx] = useState(0)
  const [custom, setCustom] = usePersisted('custom-text', 'I would like to improve my pronunciation.')
  const [draft, setDraft] = useState(custom)
  const [server, setServer] = useState<{ ready: boolean; device: string | null; error: string | null } | null>(null)
  const [, bump] = useState(0)

  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const h = await health()
        if (stop) return
        setServer(h)
        if (!h.ready && !h.error) setTimeout(poll, 1500)
      } catch {
        if (stop) return
        setServer(null)
        setTimeout(poll, 2000)
      }
    }
    poll()
    return () => { stop = true }
  }, [])

  const lesson = LESSONS.find((l) => l.id === lessonId)

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>Luyện Phát Âm</span>
        </div>
        <nav className="tabs">
          {([['lessons', 'Bài học', BookIcon], ['custom', 'Tự nhập câu', PenIcon], ['shadow', 'Shadowing', WaveIcon], ['conv', 'Hội thoại AI', ChatIcon], ['progress', 'Tiến độ', ChartIcon]] as const).map(([k, l, Icon]) => (
            <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}><Icon size={17} /><span>{l}</span></button>
          ))}
        </nav>
        <div className="top-right">
          <div className="seg" role="group" aria-label="Độ khó chấm điểm" title="Độ khắt khe khi chấm điểm">
            {(Object.keys(STRICTNESS_LABEL) as Strictness[]).map((k) => (
              <button key={k} className={strictness === k ? 'active' : ''} onClick={() => setStrictness(k)}>
                {STRICTNESS_LABEL[k]}
              </button>
            ))}
          </div>
          <select value={accent} onChange={(e) => setAccent(e.target.value as Accent)} aria-label="Giọng mẫu">
            <option value="en-US">Giọng Mỹ</option>
            <option value="en-GB">Giọng Anh</option>
          </select>
          <span className={`status ${server?.ready ? 'ok' : server?.error ? 'err' : 'wait'}`}
            title={server?.error ?? ''}>
            {server?.ready ? 'Sẵn sàng' : server?.error ? 'Chưa sẵn sàng' : server ? 'Đang khởi động...' : 'Đang kết nối...'}
          </span>
        </div>
      </header>

      <main className={view === 'conv' ? 'main-conv' : ''}>
        {view === 'lessons' && !lesson && (
          <div className="lesson-grid">
            {LESSONS.map((l) => {
              const done = l.items.map(bestScore).filter((s): s is number => s !== null)
              const avg = done.length ? done.reduce((a, b) => a + b, 0) / done.length : null
              return (
                <button key={l.id} className="card lesson" onClick={() => { setLessonId(l.id); setIdx(0) }}>
                  <div className="lesson-focus">{l.focus}</div>
                  <h3>{l.title}</h3>
                  <p className="muted small">{l.desc}</p>
                  <div className="lesson-foot">
                    <span className="muted small">{done.length}/{l.items.length} đã luyện</span>
                    {avg !== null && <span className={`pill ${statusOf(avg)}`}>{Math.round(avg)}%</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {view === 'lessons' && lesson && (
          <>
            <div className="lesson-bar">
              <button className="btn link" onClick={() => setLessonId(null)}><ChevronLeft size={18} /> Tất cả bài học</button>
              <h2>{lesson.title}</h2>
            </div>
            <div className="item-strip">
              {lesson.items.map((it, i) => {
                const b = bestScore(it)
                return (
                  <button key={it} className={`item ${i === idx ? 'active' : ''} ${b !== null ? statusOf(b) : ''}`}
                    onClick={() => setIdx(i)} title={it}>
                    {it.length > 22 ? it.slice(0, 20) + '…' : it}
                  </button>
                )
              })}
            </div>
            <Practice
              text={lesson.items[idx]}
              accent={accent}
              strictness={strictness}
              position={`${idx + 1} / ${lesson.items.length}`}
              onPrev={idx > 0 ? () => setIdx(idx - 1) : undefined}
              onNext={idx < lesson.items.length - 1 ? () => setIdx(idx + 1) : undefined}
              onScored={() => bump((n) => n + 1)}
            />
          </>
        )}

        {view === 'custom' && (
          <>
            <form className="card custom-form" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) setCustom(draft.trim()) }}>
              <label htmlFor="custom">Nhập từ hoặc câu tiếng Anh bạn muốn luyện (ví dụ câu trả lời IELTS của bạn):</label>
              <div className="custom-row">
                <textarea id="custom" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (draft.trim()) setCustom(draft.trim()) } }} />
                <button className="btn primary" type="submit">Luyện câu này</button>
              </div>
            </form>
            <Practice text={custom} accent={accent} strictness={strictness} />
          </>
        )}

        {view === 'shadow' && <Shadowing accent={accent} strictness={strictness} />}

        {/* kept mounted so a running conversation survives tab switches */}
        <div hidden={view !== 'conv'} className="conv-host">
          <Conversation accent={accent} strictness={strictness}
            onPractice={(t) => { setCustom(t); setDraft(t); setView('custom') }} />
        </div>

        {view === 'progress' && (
          <Progress onPractice={(t) => { setCustom(t); setDraft(t); setView('custom') }} />
        )}

        <footer className="muted small">
          Chấm điểm phát âm được xử lý ngay trên máy của bạn. Giọng nói của bạn không được gửi lên internet.
        </footer>
      </main>
    </div>
  )
}

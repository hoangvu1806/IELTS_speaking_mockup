import { useMemo, useState } from 'react'
import { LESSONS } from '../data/lessons'
import type { Strictness } from '../lib/scoring'
import type { Accent } from '../lib/tts'
import { Practice } from './Practice'

const SHADOW_EXTRA = [
  'Well, to be honest, I have never really thought about it before.',
  'It depends on the situation, but generally speaking, I prefer staying at home.',
  'One of the main reasons is that it helps me relax after a long day at work.',
  'I used to play the piano when I was a child, but I gave it up when I went to university.',
  'If I had more free time, I would definitely travel around the world.',
  'On the one hand, technology makes our lives easier; on the other hand, it can be quite distracting.',
  'What I like most about my hometown is the friendly atmosphere and the delicious street food.',
  'I would say that the biggest challenge for young people nowadays is finding a stable job.',
]

interface Props {
  accent: Accent
  strictness: Strictness
}

/** Shadowing: listen to a natural AI voice, imitate it immediately, get pronunciation +
 *  intonation + rhythm feedback. */
export function Shadowing({ accent, strictness }: Props) {
  const groups = useMemo(() => [
    { title: 'Câu nói tự nhiên (IELTS)', items: SHADOW_EXTRA },
    ...LESSONS.map((l) => ({ title: l.title, items: l.items.filter((t) => t.trim().split(/\s+/).length >= 4) }))
      .filter((g) => g.items.length),
  ], [])
  const [text, setText] = useState(SHADOW_EXTRA[0])
  const [custom, setCustom] = useState('')

  return (
    <div className="shadow-layout">
      <aside className="shadow-list">
        <div className="shadow-intro">
          <h2>Shadowing</h2>
          <p className="muted small">Nghe giọng AI đọc tự nhiên, rồi nhại lại ngay: bắt chước cả âm, trọng âm, ngữ điệu và nhịp nói. Bạn được chấm phát âm và so sánh đường lên xuống giọng với giọng mẫu.</p>
        </div>
        <form className="shadow-custom" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) setText(custom.trim()) }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Dán câu của bạn để shadow…" />
          <button className="btn primary sm" type="submit">Dùng</button>
        </form>
        {groups.map((g) => (
          <div key={g.title} className="shadow-group">
            <div className="shadow-group-title">{g.title}</div>
            {g.items.map((t) => (
              <button key={t} className={`shadow-item ${t === text ? 'active' : ''}`} onClick={() => setText(t)}>{t}</button>
            ))}
          </div>
        ))}
      </aside>
      <section className="shadow-main">
        <Practice key={text} text={text} accent={accent} strictness={strictness} shadow />
      </section>
    </div>
  )
}

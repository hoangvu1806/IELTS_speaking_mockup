import { useMemo, useState, type CSSProperties } from 'react'

interface SavedReport {
  t: number
  mode: string
  overall: number
  bands: number[]
  cefr?: string
  label: string
}

const SERIES: [string, string][] = [
  ['Overall', 'var(--primary)'],
  ['Fluency', '#17c3b2'],
  ['Lexical', '#f59e0b'],
  ['Grammar', '#ec4899'],
  ['Pronunciation', '#0ea5e9'],
]

function load(): SavedReport[] {
  try {
    return JSON.parse(localStorage.getItem('conv-reports-v1') ?? '[]')
  } catch {
    return []
  }
}

/** Band history of AI conversation / exam / lesson reports (stored by the Conversation tab). */
export function BandChart() {
  const reports = useMemo(() => load().sort((a, b) => a.t - b.t).slice(-30), [])
  const [on, setOn] = useState<boolean[]>([true, false, false, false, false])
  if (!reports.length) return null

  const W = 640, H = 170, lo = 4, hi = 9, padL = 28
  const x = (i: number) => padL + (reports.length === 1 ? (W - padL) / 2 : (i / (reports.length - 1)) * (W - padL))
  const y = (b: number) => H - ((Math.max(lo, Math.min(hi, b)) - lo) / (hi - lo)) * H
  const value = (r: SavedReport, s: number) => (s === 0 ? r.overall : r.bands[s - 1])
  const last = reports[reports.length - 1]
  const first = reports[0]
  const delta = last.overall - first.overall
  const best = Math.max(...reports.map((r) => r.overall))

  return (
    <div className="card band-card">
      <div className="row-between">
        <div>
          <h3>Band IELTS qua các buổi hội thoại AI</h3>
          <p className="muted small">Thi thử, học với giáo viên và trò chuyện: {reports.length} buổi gần nhất.</p>
        </div>
        <div className="band-kpis">
          <div><span className="muted small">Gần nhất</span><b>{last.overall.toFixed(1)}</b></div>
          <div><span className="muted small">Cao nhất</span><b>{best.toFixed(1)}</b></div>
          <div><span className="muted small">Thay đổi</span><b className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}</b></div>
        </div>
      </div>
      <div className="series-toggle">
        {SERIES.map(([name, color], s) => (
          <button key={name} className={on[s] ? 'active' : ''} style={{ '--sc': color } as CSSProperties}
            onClick={() => setOn(on.map((v, k) => (k === s ? !v : v)))}><i />{name}</button>
        ))}
      </div>
      <svg viewBox={`0 -10 ${W} ${H + 20}`} className="band-svg" role="img" aria-label="Biểu đồ band theo buổi">
        {[4, 5, 6, 7, 8, 9].map((b) => (
          <g key={b}>
            <line x1={padL} x2={W} y1={y(b)} y2={y(b)} className="grid" />
            <text x={0} y={y(b) + 4} className="band-axis">{b}</text>
          </g>
        ))}
        {SERIES.map(([name, color], s) => on[s] && (
          <g key={name}>
            <polyline points={reports.map((r, i) => `${x(i)},${y(value(r, s))}`).join(' ')} fill="none" stroke={color}
              strokeWidth={s === 0 ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
            {reports.map((r, i) => (
              <circle key={i} cx={x(i)} cy={y(value(r, s))} r={s === 0 ? 5 : 3.5} fill={color}>
                <title>{`${r.label} · ${new Date(r.t).toLocaleDateString('vi-VN')} · ${name} ${value(r, s).toFixed(1)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}

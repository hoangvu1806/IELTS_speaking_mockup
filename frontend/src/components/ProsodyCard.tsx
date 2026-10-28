import type { Prosody } from '../lib/api'
import { statusOf } from './ScoreRing'

/** Splits a curve with gaps (unvoiced frames) into separate polyline segments. */
function segments(values: (number | null)[], W: number, H: number, lo: number, hi: number): string[] {
  const out: string[] = []
  let cur: string[] = []
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length > 1) out.push(cur.join(' '))
      cur = []
      return
    }
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - lo) / (hi - lo)) * H
    cur.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  })
  if (cur.length > 1) out.push(cur.join(' '))
  return out
}

function paceText(r: number) {
  if (r > 1.15) return `chậm hơn giọng mẫu ${Math.round((r - 1) * 100)}%`
  if (r < 0.87) return `nhanh hơn giọng mẫu ${Math.round((1 - r) * 100)}%`
  return 'tốc độ gần giống giọng mẫu'
}

export function ProsodyCard({ p }: { p: Prosody }) {
  const W = 640, H = 150
  // ±12 semitones covers normal speech; rare pitch-tracking outliers must not squash the chart
  const all = [...p.curves.ref, ...p.curves.user].filter((v): v is number => v != null && Math.abs(v) <= 12)
  const lo = Math.min(-6, ...all) - 1, hi = Math.max(6, ...all) + 1
  const clip = (c: (number | null)[]) => c.map((v) => (v == null || Math.abs(v) > 12 ? null : v))
  const flat = p.pitch_range.ref > 2 && p.pitch_range.user < p.pitch_range.ref * 0.6
  const tips: string[] = []
  if (p.intonation < 60) tips.push('Đường lên xuống giọng còn khác giọng mẫu: nghe lại và chú ý những chỗ giọng mẫu lên cao (từ được nhấn) hoặc hạ xuống ở cuối câu.')
  if (flat) tips.push(`Giọng của bạn hơi đều (biên độ ${p.pitch_range.user} so với ${p.pitch_range.ref} nửa cung). Hãy nhấn mạnh từ khoá và lên xuống giọng nhiều hơn.`)
  if (p.rhythm < 65) tips.push('Nhịp nói chưa đều theo mẫu: tiếng Anh nhấn vào từ nội dung, đọc lướt các từ chức năng (a, the, of, to).')
  if (p.pace < 60) tips.push(`Tốc độ: ${paceText(p.pace_ratio)}. Hãy bám sát nhịp của giọng mẫu.`)
  if (!tips.length) tips.push('Rất tốt! Ngữ điệu và nhịp điệu của bạn bám sát giọng mẫu.')

  return (
    <div className="card prosody-card">
      <div className="prosody-head">
        <div>
          <h3>Ngữ điệu & nhịp điệu (shadowing)</h3>
          <p className="muted small">So sánh với giọng AI mẫu: đường cao độ sau khi căn thời gian bằng DTW.</p>
        </div>
        <span className={`prosody-total ${statusOf(p.overall)}`}>{Math.round(p.overall)}<small>/100</small></span>
      </div>
      <div className="prosody-metrics">
        {([['Ngữ điệu', p.intonation], ['Nhịp điệu', p.rhythm], ['Tốc độ', p.pace]] as const).map(([l, v]) => (
          <div key={l} className={statusOf(v)}>
            <span className="muted small">{l}</span>
            <b>{Math.round(v)}</b>
            <div className="bar"><span style={{ width: `${v}%` }} /></div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pitch-chart" role="img" aria-label="Đường cao độ: giọng mẫu và giọng bạn">
        <line x1={0} x2={W} y1={H - ((0 - lo) / (hi - lo)) * H} y2={H - ((0 - lo) / (hi - lo)) * H} className="pitch-zero" />
        {segments(clip(p.curves.ref), W, H, lo, hi).map((pts, i) => <polyline key={`r${i}`} points={pts} className="pitch-ref" />)}
        {segments(clip(p.curves.user), W, H, lo, hi).map((pts, i) => <polyline key={`u${i}`} points={pts} className="pitch-user" />)}
      </svg>
      <div className="pitch-legend small">
        <span><i className="lg-ref" /> Giọng mẫu (AI)</span>
        <span><i className="lg-user" /> Giọng bạn</span>
        <span className="muted">{paceText(p.pace_ratio)} · {p.durations.user}s / {p.durations.ref}s</span>
      </div>
      <ul className="prosody-tips">{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}

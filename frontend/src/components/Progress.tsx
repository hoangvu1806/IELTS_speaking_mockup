import { useMemo, useState } from 'react'
import { clearHistory, loadHistory } from '../lib/storage'
import { PHONEMES } from '../data/phonemes'
import { statusOf } from './ScoreRing'
import { BandChart } from './BandChart'

export function Progress({ onPractice }: { onPractice: (text: string) => void }) {
  const [history, setHistory] = useState(loadHistory)

  const stats = useMemo(() => {
    const by: Record<string, { sum: number; n: number }> = {}
    for (const a of history.slice(0, 200))
      for (const p of a.phones) {
        const s = (by[p.arpa] ??= { sum: 0, n: 0 })
        s.sum += p.score
        s.n++
      }
    return Object.entries(by)
      .filter(([, v]) => v.n >= 3)
      .map(([arpa, v]) => ({ arpa, avg: v.sum / v.n, n: v.n }))
      .sort((a, b) => a.avg - b.avg)
  }, [history])

  if (!history.length)
    return (
      <div className="progress">
        <BandChart />
        <div className="card empty">Chưa có lượt luyện phát âm nào. Hãy bắt đầu từ mục <b>Bài học</b>!</div>
      </div>
    )

  const recent = history.slice(0, 30).reverse()
  const avg = history.slice(0, 20).reduce((s, a) => s + a.overall, 0) / Math.min(20, history.length)
  const W = 600, H = 120
  const pts = recent.map((a, i) => [recent.length === 1 ? W / 2 : (i / (recent.length - 1)) * W, H - (a.overall / 100) * H])

  return (
    <div className="progress">
      <BandChart />
      <div className="stat-row">
        <div className="card stat"><span className="muted small">Số lượt luyện</span><b>{history.length}</b></div>
        <div className="card stat"><span className="muted small">Điểm TB (20 lượt gần nhất)</span><b className={statusOf(avg)}>{Math.round(avg)}%</b></div>
        <div className="card stat"><span className="muted small">Âm cần luyện nhất</span>
          <b className={stats[0] ? statusOf(stats[0].avg) : ''}>{stats[0] && stats[0].avg < 80 ? `/${PHONEMES[stats[0].arpa]?.ipa ?? stats[0].arpa}/` : 'Chưa có'}</b></div>
      </div>

      <div className="card">
        <h3>Điểm 30 lượt gần nhất</h3>
        <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} className="trend">
          {[50, 80].map((y) => <line key={y} x1={0} x2={W} y1={H - (y / 100) * H} y2={H - (y / 100) * H} className="grid" />)}
          <polyline points={pts.map((p) => p.join(',')).join(' ')} className="trend-line" />
          {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} className={`trend-dot ${statusOf(recent[i].overall)}`}><title>{recent[i].text}: {Math.round(recent[i].overall)}%</title></circle>)}
        </svg>
      </div>

      <div className="card">
        <h3>Phân tích từng âm</h3>
        <p className="muted small">Điểm trung bình của từng âm vị (cần ít nhất 3 lần xuất hiện). Âm yếu nhất ở trên cùng.</p>
        <div className="ph-stats">
          {stats.map((s) => (
            <div key={s.arpa} className="ph-stat">
              <span className={`chip ${statusOf(s.avg)}`}>/{PHONEMES[s.arpa]?.ipa ?? s.arpa}/</span>
              <span className="bar"><span style={{ width: `${s.avg}%` }} className={statusOf(s.avg)} /></span>
              <span className="phone-score">{Math.round(s.avg)}</span>
              <span className="muted small">{s.n} lần · {PHONEMES[s.arpa]?.example}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h3>Lịch sử</h3>
          <button className="btn link danger" onClick={() => { if (confirm('Xoá toàn bộ lịch sử luyện tập?')) { clearHistory(); setHistory([]) } }}>Xoá lịch sử</button>
        </div>
        <ul className="history">
          {history.slice(0, 40).map((a) => (
            <li key={a.t}>
              <button onClick={() => onPractice(a.text)}>
                <span className={`pill ${statusOf(a.overall)}`}>{Math.round(a.overall)}%</span>
                <span className="h-text">{a.text}</span>
                <span className="muted small">{new Date(a.t).toLocaleString('vi-VN')}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

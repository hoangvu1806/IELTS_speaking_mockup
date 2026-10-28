export function statusOf(score: number) {
  return score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad'
}

export function ScoreRing({ score, size = 112 }: { score: number; size?: number }) {
  const r = (size - 12) / 2
  const c = 2 * Math.PI * r
  const s = statusOf(score)
  return (
    <div className={`ring ${s}`} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bar"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-label">
        <b>{Math.round(score)}</b>
        <span>%</span>
      </div>
    </div>
  )
}

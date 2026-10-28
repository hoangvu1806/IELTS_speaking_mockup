"""Shadowing analysis: compare the learner's intonation and rhythm with a reference voice.

1. Pitch (F0) with pYIN, converted to semitones relative to each speaker's own median, so a
   low male voice and a high female voice are comparable.
2. Time alignment with DTW on MFCCs (who said which part when).
3. Intonation = correlation of the aligned pitch contours; rhythm = how evenly the learner's
   timing follows the reference (deviation of the DTW path from a uniform tempo); pace = duration ratio.
"""
from __future__ import annotations

import librosa
import numpy as np

SR = 16000
HOP = 160  # 10 ms


def _trim(wav: np.ndarray) -> np.ndarray:
    hop = SR // 50
    n = len(wav) // hop
    if n < 5:
        return wav
    rms = np.sqrt((wav[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)
    idx = np.where(rms > max(np.percentile(rms, 10) * 4, rms.max() * 0.05))[0]
    if not len(idx):
        return wav
    return wav[max(0, idx[0] * hop - SR // 20): min(len(wav), (idx[-1] + 1) * hop + SR // 20)]


def _pitch_semitones(wav: np.ndarray) -> np.ndarray:
    f0, voiced, _ = librosa.pyin(wav, fmin=65, fmax=450, sr=SR, frame_length=1024, hop_length=HOP)
    st = np.full(len(f0), np.nan)
    ok = voiced & np.isfinite(f0)
    if ok.sum() >= 5:
        st[ok] = 12 * np.log2(f0[ok] / np.median(f0[ok]))
    return st


def _mfcc(wav: np.ndarray) -> np.ndarray:
    m = librosa.feature.mfcc(y=wav, sr=SR, n_mfcc=20, hop_length=HOP, n_fft=512)
    return (m - m.mean(1, keepdims=True)) / (m.std(1, keepdims=True) + 1e-6)


def _resample_curve(values: np.ndarray, n: int) -> list[float | None]:
    if len(values) == 0:
        return [None] * n
    idx = np.linspace(0, len(values) - 1, n).round().astype(int)
    return [None if not np.isfinite(values[i]) else round(float(values[i]), 2) for i in idx]


def compare(ref: np.ndarray, user: np.ndarray) -> dict:
    ref, user = _trim(ref), _trim(user)
    st_r, st_u = _pitch_semitones(ref), _pitch_semitones(user)
    # pYIN and MFCC frame counts can differ by one: align to the shorter
    m_r, m_u = _mfcc(ref), _mfcc(user)
    n_r, n_u = min(len(st_r), m_r.shape[1]), min(len(st_u), m_u.shape[1])
    st_r, st_u, m_r, m_u = st_r[:n_r], st_u[:n_u], m_r[:, :n_r], m_u[:, :n_u]

    _, path = librosa.sequence.dtw(X=m_r, Y=m_u, metric="euclidean")
    path = path[::-1]
    # learner pitch mapped onto the reference timeline
    aligned = np.full(n_r, np.nan)
    for i, j in path:
        if np.isfinite(st_u[j]):
            aligned[i] = st_u[j] if not np.isfinite(aligned[i]) else (aligned[i] + st_u[j]) / 2

    both = np.isfinite(st_r) & np.isfinite(aligned)
    if both.sum() >= 15:
        r = float(np.corrcoef(st_r[both], aligned[both])[0, 1])
        mad = float(np.mean(np.abs(st_r[both] - aligned[both])))
    else:
        r, mad = 0.0, 6.0
    # correlation 0.2 -> 0, 0.85 -> 100; penalise large average semitone gaps
    intonation = float(np.clip((r - 0.2) / 0.65, 0, 1) * 100 - max(0.0, mad - 3) * 5)
    intonation = float(np.clip(intonation, 0, 100))

    # rhythm: deviation of the warping path from uniform tempo, both axes normalised to 0..1
    pi, pj = path[:, 0] / max(1, n_r - 1), path[:, 1] / max(1, n_u - 1)
    dev = float(np.mean(np.abs(pi - pj)))
    rhythm = float(np.clip(100 - dev * 600, 0, 100))

    pace = (len(user) / SR) / max(1e-3, len(ref) / SR)
    pace_score = float(np.clip(100 - abs(np.log2(pace)) * 120, 0, 100))

    # expressiveness: a flat (monotone) delivery has a small pitch range
    def spread(st):
        v = st[np.isfinite(st)]
        return float(np.percentile(v, 90) - np.percentile(v, 10)) if len(v) > 10 else 0.0
    range_ref, range_user = spread(st_r), spread(st_u)

    overall = 0.5 * intonation + 0.3 * rhythm + 0.2 * pace_score
    return {
        "overall": round(overall, 1),
        "intonation": round(intonation, 1),
        "rhythm": round(rhythm, 1),
        "pace": round(pace_score, 1),
        "pace_ratio": round(pace, 2),
        "pitch_corr": round(r, 2),
        "pitch_range": {"ref": round(range_ref, 1), "user": round(range_user, 1)},
        "durations": {"ref": round(len(ref) / SR, 2), "user": round(len(user) / SR, 2)},
        "curves": {"ref": _resample_curve(st_r, 160), "user": _resample_curve(aligned, 160)},
    }

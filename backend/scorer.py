"""Phoneme-level pronunciation scoring.

Method: alignment-free, substitution-aware GOP on top of a CTC phoneme recogniser
(wav2vec2-lv-60-espeak-cv-ft). For every expected phoneme slot we compare the CTC
likelihood of the whole utterance under the canonical phoneme sequence against the
same sequence where that one slot is (a) replaced by any other phoneme or (b) deleted.
The resulting posterior is the slot's score; the best competing hypothesis tells the
learner what they actually said ("/s/ instead of /θ/", "omitted").
"""
from __future__ import annotations

import json
import os
import math
import time

import numpy as np
import torch
import torch.nn.functional as F
from huggingface_hub import hf_hub_download
from torchaudio.functional import forced_align, merge_tokens
from transformers import Wav2Vec2ForCTC

from g2p import Slot, WordPron, word_ipa
from spelling import align as align_letters

# XLSR-53 pre-training (CommonVoice, BABEL telephone speech...) makes it far more robust to
# real microphones / room reverb than the LibriLight-only lv-60 variant; same phoneme vocab.
MODEL_ID = os.environ.get("PRON_MODEL", "facebook/wav2vec2-xlsr-53-espeak-cv-ft")
SAMPLE_RATE = 16000

# Plausible English (and learner) realisations, used to diagnose what was said.
COMPETITORS = [
    "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "tʃ", "dʒ",
    "m", "n", "ŋ", "l", "ɹ", "w", "j", "ɾ", "ʔ", "iː", "ɪ", "ɛ", "æ", "ɑː", "ʌ", "ɔː", "ʊ",
    "uː", "ə", "ɚ", "ɜː", "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ", "i", "u", "e", "o", "a", "ɐ", "ɒ",
]
# Shown to the learner instead of the raw espeak symbol.
PRETTY = {"ɹ": "r", "ɡ": "g", "ɾ": "t/d (vỗ)", "ʔ": "ʔ (tắc thanh hầu)", "ɐ": "ə", "ᵻ": "ɪ",
          "ɑːɹ": "ɑːr", "ɔːɹ": "ɔːr", "oːɹ": "ɔːr", "ɪɹ": "ɪr", "ɛɹ": "er", "ʊɹ": "ʊr"}

# score = sigmoid((log-odds(accepted vs rejected) - OFFSET) / SLOPE). Measured on native TTS
# played through simulated mic channels: correct phones mostly land at log-odds > +1.5 but
# 10-15% dip to ~0, while real substitutions/omissions sit at -2..-7. "normal" puts the
# 50-point boundary at -1. The frontend re-scores from the raw log-odds per strictness level.
STRICTNESS = {"easy": (-1.8, 1.2), "normal": (-1.0, 1.0), "strict": (0.4, 1.0)}
SCORE_OFFSET, SCORE_SLOPE = STRICTNESS["normal"]
# prefer reporting a substitution over a deletion unless deletion is clearly more likely
DELETION_MARGIN = 1.0
# short takes (single words) are scored on a repeated copy of the audio for context
SHORT_MAX_WORDS = 2
# longer answers are aligned once, then scored in chunks of this many words
CHUNK_WORDS = 16
REPEATS = 3
REPEAT_GAP = 0.25


class NoSpeechError(Exception):
    pass


class Scorer:
    def __init__(self, device: str | None = None):
        self.device = device or os.environ.get("PRON_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
        if self.device == "cuda":
            # fp32 is ~4x faster than fp16 on GTX 16xx cards (~1.3 GB VRAM); PRON_FP16=1 halves VRAM
            dtype = torch.float16 if os.environ.get("PRON_FP16") == "1" else torch.float32
            self.model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID, dtype=dtype)
        else:
            self.model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
            # int8 linear layers: ~3x smaller & faster on CPU, negligible accuracy loss
            self.model = torch.ao.quantization.quantize_dynamic(
                self.model, {torch.nn.Linear}, dtype=torch.qint8)
        self.model.to(self.device).eval()
        self.dtype = next(self.model.parameters()).dtype if self.device == "cuda" else torch.float32

        with open(hf_hub_download(MODEL_ID, "vocab.json"), encoding="utf-8") as f:
            self.vocab: dict[str, int] = json.load(f)
        self.id2tok = {i: t for t, i in self.vocab.items()}
        self.blank = self.model.config.pad_token_id
        self.comp_tokens = [t for t in COMPETITORS if t in self.vocab]
        self.comp_ids = torch.tensor([self.vocab[t] for t in self.comp_tokens])
        ratio = int(np.prod(self.model.config.conv_stride))
        self.frame_sec = ratio / SAMPLE_RATE
        self.warmup()

    # ------------------------------------------------------------------ model
    def warmup(self):
        self.emissions(np.zeros(SAMPLE_RATE, dtype=np.float32))

    def emissions(self, wav: np.ndarray) -> torch.Tensor:
        x = (wav - wav.mean()) / math.sqrt(float(wav.var()) + 1e-7)
        t = torch.from_numpy(x.astype(np.float32))[None].to(self.device, self.dtype)
        with torch.inference_mode():
            logits = self.model(t).logits[0].float()
        return logits.log_softmax(-1).cpu()  # (T, V)

    def greedy(self, lp: torch.Tensor) -> list[str]:
        ids = lp.argmax(-1).tolist()
        out, prev = [], None
        for i in ids:
            if i != prev and i != self.blank:
                out.append(self.id2tok[i])
            prev = i
        return out

    # ------------------------------------------------------------- CTC maths
    def _columns(self, lp: torch.Tensor, slots: list[Slot]):
        """Compact emission matrix: [blank | competitors | slot-accept]."""
        n, e = len(slots), len(self.comp_tokens)
        acc_cols = []
        for s in slots:
            ids = [self.vocab[t] for t in s.accept if t in self.vocab]
            acc_cols.append(lp[:, ids].logsumexp(-1))
        emis = torch.cat([lp[:, [self.blank]], lp[:, self.comp_ids], torch.stack(acc_cols, 1)], 1)
        acc_id = [1 + e + i for i in range(n)]
        return emis, acc_id

    def _seq_ll(self, emis: torch.Tensor, seqs: list[list[int]], chunk: int = 512) -> torch.Tensor:
        """Batched CTC log-likelihood of each target sequence (runs on GPU when available)."""
        emis = emis.to(self.device)
        T = emis.shape[0]
        out = []
        for k in range(0, len(seqs), chunk):
            batch = seqs[k:k + chunk]
            B = len(batch)
            L = max(1, max(len(s) for s in batch))
            tgt = torch.zeros(B, L, dtype=torch.long)
            for b, s in enumerate(batch):
                if s:
                    tgt[b, :len(s)] = torch.tensor(s)
            loss = F.ctc_loss(
                emis[:, None, :].expand(T, B, emis.shape[1]).contiguous(), tgt.to(self.device),
                torch.full((B,), T, dtype=torch.long, device=self.device),
                torch.tensor([len(s) for s in batch], dtype=torch.long, device=self.device),
                blank=0, reduction="none", zero_infinity=False)
            out.append(-loss.cpu())
        ll = torch.cat(out)
        return torch.nan_to_num(ll, nan=-1e9, neginf=-1e9)

    def _ref_ll(self, lp, slots):
        emis, acc_id = self._columns(lp, slots)
        return float(self._seq_ll(emis, [acc_id])[0])

    @staticmethod
    def _snr_db(wav: np.ndarray) -> float:
        """Rough SNR: loud (speech) frames vs quiet (background) frames."""
        hop = SAMPLE_RATE // 50
        n = len(wav) // hop
        if n < 10:
            return 99.0
        e = np.sort((wav[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)
        return float(10 * np.log10(e[int(n * 0.9):].mean() / e[: max(1, int(n * 0.15))].mean()))

    @staticmethod
    def _pauses(wav: np.ndarray, words: list[dict], min_sec: float = 0.4) -> list[dict]:
        """Silent stretches (low RMS energy) between consecutive words."""
        hop = SAMPLE_RATE // 50
        n = len(wav) // hop
        if n < 2:
            return []
        rms = np.sqrt((wav[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-10)
        silent = rms < max(1e-4, np.percentile(rms, 95) * 0.08)
        out = []
        for a, b in zip(words, words[1:]):
            i0, i1 = int(a["end"] * 50) + 1, int(b["start"] * 50)
            run = best = 0
            for s in silent[i0:i1]:
                run = run + 1 if s else 0
                best = max(best, run)
            if best / 50 >= min_sec:
                out.append({"after": a["text"], "sec": round(best / 50, 2)})
        return out

    def _score(self, lp: torch.Tensor, slots: list[Slot]) -> list[dict]:
        """Per slot: log-odds (accepted vs substituted/omitted), diagnosis, frame span."""
        n, e = len(slots), len(self.comp_tokens)
        emis, acc_id = self._columns(lp, slots)

        # hypotheses: ref, then per slot: deletion, each competitor
        seqs = [acc_id]
        per = 1 + e
        for i in range(n):
            seqs.append(acc_id[:i] + acc_id[i + 1:])
            for c in range(e):
                seqs.append(acc_id[:i] + [1 + c] + acc_id[i + 1:])
        ll = self._seq_ll(emis, seqs)
        ref = ll[0]

        # timing from Viterbi forced alignment of the canonical sequence
        spans = [(0, 0)] * n
        try:
            ali, sc = forced_align(emis[None], torch.tensor([acc_id]), blank=0)
            toks = merge_tokens(ali[0], sc[0].exp(), blank=0)
            if len(toks) == n:
                spans = [(t.start, t.end) for t in toks]
        except Exception:
            pass

        out = []
        for i, s in enumerate(slots):
            base = 1 + i * per
            dele = ll[base]
            comps = ll[base + 1: base + 1 + e]
            # rejected = plausible English substitutions (+ omission); exotic tokens of the
            # multilingual vocab are ignored so channel noise is not mistaken for errors
            mask = torch.tensor([t not in s.accept for t in self.comp_tokens])
            comps = torch.where(mask, comps, torch.full_like(comps, -1e9))
            acc = [ref] + ([dele] if s.optional else [])
            rej = [comps] + ([] if s.optional else [dele[None]])
            log_odds = float(torch.logsumexp(torch.stack(acc), 0) - torch.logsumexp(torch.cat(rej), 0))

            # diagnosis: best competing hypothesis that the model prefers over the reference
            ci = int(comps.argmax())
            best_alt, best_tok = float(comps[ci]), self.comp_tokens[ci]
            heard_as = None
            if not s.optional and float(dele) > best_alt + DELETION_MARGIN and float(dele) > float(ref):
                heard_as = "-"
            elif best_alt > float(ref):
                heard_as = PRETTY.get(best_tok, best_tok)
            out.append({"lo": log_odds, "heard": heard_as, "span": spans[i]})
        return out

    def _pick_variants(self, lp: torch.Tensor, scored: list[WordPron]) -> list[list[Slot]]:
        """Pick the dictionary variant (e.g. "the" ðə / ði) that best matches the audio."""
        choice = [w.prons[0] for w in scored]
        for wi, w in enumerate(scored):
            if len(w.prons) > 1:
                best, best_ll = choice[wi], -math.inf
                for p in w.prons:
                    trial = choice[:wi] + [p] + choice[wi + 1:]
                    ll = self._ref_ll(lp, [s for ws in trial for s in ws])
                    if ll > best_ll:
                        best, best_ll = p, ll
                choice[wi] = best
        return choice

    def _score_long(self, lp: torch.Tensor, scored: list[WordPron]):
        """Long answers: align the whole transcript once, then score chunks of words on
        their own slice of the emissions (cost grows with chunk size, not answer length)."""
        prons = [w.prons[0] for w in scored]
        slots = [s for p in prons for s in p]
        T, nw = lp.shape[0], len(scored)
        if T < len(slots) + 2:
            raise ValueError("Bản ghi quá ngắn so với nội dung.")
        emis, acc_id = self._columns(lp, slots)
        ali, sc = forced_align(emis[None], torch.tensor([acc_id]), blank=0)
        toks = merge_tokens(ali[0], sc[0].exp(), blank=0)
        if len(toks) != len(slots):
            raise ValueError("Không căn chỉnh được bản ghi với nội dung.")
        wspan, k = [], 0
        for p in prons:
            wspan.append((toks[k].start, toks[k + len(p) - 1].end))
            k += len(p)

        choice, raw = [], []
        for c0 in range(0, nw, CHUNK_WORDS):
            a_w, b_w = c0, min(nw, c0 + CHUNK_WORDS) - 1
            lo = (wspan[a_w - 1][1] + wspan[a_w][0]) // 2 if a_w else 0
            hi = (wspan[b_w][1] + wspan[b_w + 1][0]) // 2 + 1 if b_w + 1 < nw else T
            sub = lp[lo:hi]
            ch = self._pick_variants(sub, scored[a_w:b_w + 1])
            ch_slots = [s for p in ch for s in p]
            if sub.shape[0] < len(ch_slots) + 2:  # degenerate alignment: fall back to the full span
                sub, lo = lp, 0
            for r in self._score(sub, ch_slots):
                raw.append({"lo": r["lo"], "heard": r["heard"],
                            "t": ((r["span"][0] + lo) * self.frame_sec, (r["span"][1] + lo) * self.frame_sec)})
            choice += ch
        return choice, raw

    def emissions_long(self, wav: np.ndarray, max_sec: float = 20.0) -> torch.Tensor:
        """Emissions for audio of any length: split at the quietest point near each 20 s
        boundary so attention memory stays bounded (a 2-minute Part 2 answer fits in 4 GB)."""
        if len(wav) <= max_sec * SAMPLE_RATE:
            return self.emissions(wav)
        hop = int(self.frame_sec * SAMPLE_RATE)
        n = len(wav) // hop
        rms = (wav[:n * hop].reshape(n, hop) ** 2).mean(1)
        pieces, start = [], 0
        while len(wav) - start > max_sec * SAMPLE_RATE:
            lo_f = (start + int((max_sec - 5) * SAMPLE_RATE)) // hop
            hi_f = (start + int(max_sec * SAMPLE_RATE)) // hop
            cut = (lo_f + int(np.argmin(rms[lo_f:hi_f]))) * hop
            pieces.append(wav[start:cut])
            start = cut
        pieces.append(wav[start:])
        return torch.cat([self.emissions(p) for p in pieces])

    @staticmethod
    def _trim(wav: np.ndarray) -> tuple[np.ndarray, float]:
        """Cut leading/trailing silence. Returns (core, start offset in seconds)."""
        hop = SAMPLE_RATE // 50
        n = len(wav) // hop
        if n < 5:
            return wav, 0.0
        rms = np.sqrt((wav[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)
        thr = max(np.percentile(rms, 10) * 4, rms.max() * 0.06)
        idx = np.where(rms > thr)[0]
        if not len(idx):
            return wav, 0.0
        a = max(0, idx[0] * hop - int(0.1 * SAMPLE_RATE))
        b = min(len(wav), (idx[-1] + 1) * hop + int(0.15 * SAMPLE_RATE))
        return wav[a:b], a / SAMPLE_RATE

    # ----------------------------------------------------------------- public
    def assess(self, wav: np.ndarray, words: list[WordPron]) -> dict:
        t0 = time.perf_counter()
        lp = self.emissions_long(wav)
        T = lp.shape[0]
        heard = self.greedy(lp)
        if not heard:
            raise NoSpeechError("Không nghe thấy giọng nói. Hãy nói to, rõ hơn và gần micro.")

        scored = [w for w in words if not w.oov]
        if not scored:
            raise ValueError("Câu không có từ nào trong từ điển phát âm.")

        if len(scored) > CHUNK_WORDS:
            choice, raw = self._score_long(lp, scored)
            slots = [s for ws in choice for s in ws]
            n = len(slots)
        else:
            choice = self._pick_variants(lp, scored)
            slots = [s for ws in choice for s in ws]
            n = len(slots)
            if T < n + 2:
                raise ValueError("Bản ghi quá ngắn so với câu. Hãy đọc hết cả câu.")

        if len(scored) > CHUNK_WORDS:
            pass  # raw already computed chunk by chunk
        elif len(scored) <= SHORT_MAX_WORDS:
            # A lone word gives the model ~0.5 s of context and makes it fragile on real
            # microphones. Repeating the take (word-pause-word-pause-word) supplies speaker
            # and channel context; per-phone evidence is then averaged over the copies.
            core, offset = self._trim(wav)
            gap = np.zeros(int(REPEAT_GAP * SAMPLE_RATE), dtype=np.float32)
            rep = np.concatenate([gap] + [x for _ in range(REPEATS) for x in (core, gap)])
            lp_rep = self.emissions(rep)
            copies = self._score(lp_rep, slots * REPEATS)
            # show what the model heard in the middle copy (best context on both sides)
            seg = (len(gap) + len(core)) / SAMPLE_RATE / self.frame_sec
            mid = REPEATS // 2
            heard = self.greedy(lp_rep[int(mid * seg):int((mid + 1) * seg + 1)]) or heard
            raw = []
            for i in range(n):
                cs = [copies[c * n + i] for c in range(REPEATS)]
                worst = min(cs, key=lambda r: r["lo"])
                start, end = cs[0]["span"]
                shift = offset - REPEAT_GAP
                raw.append({"lo": sum(r["lo"] for r in cs) / REPEATS, "heard": worst["heard"],
                            "t": (max(0.0, start * self.frame_sec + shift), max(0.0, end * self.frame_sec + shift))})
        else:
            raw = [{**r, "t": (r["span"][0] * self.frame_sec, r["span"][1] * self.frame_sec)}
                   for r in self._score(lp, slots)]

        phone_results = []
        for s, r in zip(slots, raw):
            score = 100 / (1 + math.exp(-(r["lo"] - SCORE_OFFSET) / SCORE_SLOPE))
            status = "good" if score >= 80 else "warn" if score >= 50 else "bad"
            phone_results.append({
                "arpa": s.arpa, "ipa": s.ipa, "score": round(score, 1), "status": status,
                "lo": round(r["lo"], 2), "heard": r["heard"],
                "start": round(r["t"][0], 3), "end": round(r["t"][1], 3),
            })

        # regroup into words
        out_words, k = [], 0
        word_iter = iter(choice)
        for w in words:
            if w.oov:
                out_words.append({"text": w.text, "start_char": w.start, "end_char": w.end,
                                  "oov": True, "ipa": "", "score": None, "phones": []})
                continue
            ws = next(word_iter)
            ph = phone_results[k:k + len(ws)]
            k += len(ws)
            wscore = sum(p["score"] for p in ph) / len(ph)
            out_words.append({
                "text": w.text, "start_char": w.start, "end_char": w.end, "oov": False,
                "ipa": word_ipa(ws), "score": round(wscore, 1), "phones": ph,
                "letters": align_letters(w.text, tuple(s.arpa for s in ws)),
                "start": ph[0]["start"], "end": ph[-1]["end"],
            })

        overall = sum(p["score"] for p in phone_results) / n
        sw = [w for w in out_words if not w["oov"]]
        speech_dur = max(1e-3, sw[-1]["end"] - sw[0]["start"])
        pauses = self._pauses(wav, sw)
        # CTC emits short spikes; widen word windows to the midpoint between neighbours
        dur = len(wav) / SAMPLE_RATE
        spikes = [(w["start"], w["end"]) for w in sw]
        for i, w in enumerate(sw):
            s0, s1 = spikes[i]
            if i == 0:
                start = max(0.0, s0 - 0.3)
            else:
                start = max((spikes[i - 1][1] + s0) / 2, s0 - 0.25)
            if i + 1 == len(sw):
                end = min(dur, s1 + 0.35)
            else:
                end = min((s1 + spikes[i + 1][0]) / 2, s1 + 0.3)
            w["start"], w["end"] = round(start, 3), round(end, 3)
        snr = self._snr_db(wav)
        warning = None
        if snr < 15:
            warning = "Môi trường khá ồn hoặc micro thu nhỏ, kết quả có thể kém chính xác. Hãy nói gần micro hơn, ở nơi yên tĩnh."
        elif float(np.mean(np.abs(wav) > 0.98)) > 0.002:  # sustained clipping, not a single peak
            warning = "Âm thanh bị rè (quá to). Hãy nói nhỏ lại hoặc để micro xa hơn một chút."
        return {
            "overall": round(overall, 1),
            "snr_db": round(snr, 1),
            "warning": warning,
            "words": out_words,
            "heard_ipa": " ".join(PRETTY.get(h, h) for h in heard),
            "wpm": round(len(sw) / speech_dur * 60) if len(sw) > 1 else None,
            "pauses": pauses,
            "duration": round(len(wav) / SAMPLE_RATE, 2),
            "device": self.device,
            "ms": round((time.perf_counter() - t0) * 1000),
        }

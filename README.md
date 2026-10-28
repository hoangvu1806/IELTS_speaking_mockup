# IELTS Speaking Practice

A full-stack web application for IELTS Speaking preparation that combines **local phoneme-level pronunciation scoring** with an **AI conversation partner** — running the acoustic model entirely on-device so your voice recordings never leave your machine.

---

## Features

### Pronunciation Practice
- Record a word or sentence and receive instant per-phoneme feedback (colour-coded IPA overlay).
- Scoring uses an alignment-free, substitution-aware **Goodness-of-Pronunciation (GOP)** algorithm on top of a wav2vec2 CTC acoustic model — no cloud service, no upload.
- Three difficulty levels (Easy / Medium / Hard) recalculate scores in real time without re-inference.
- Built-in lesson library covering common IELTS vocabulary; add your own entries in `frontend/src/data/lessons.ts`.

### AI Conversation (requires OpenRouter API key)
Three modes, all driven by the same streaming STT → LLM → TTS pipeline:

| Mode | Description |
|---|---|
| **IELTS Mock Exam** | A neutral AI examiner conducts a full Part 1 → Part 2 (cue card + 1 min prep + 2 min talk) → Part 3. Ends with a band-score report across four criteria. |
| **Free Chat** | A friendly English conversation partner. Choose proficiency level (A2–C1) and topic or role-play scenario. |
| **Teacher (Anna)** | A 1-on-1 IELTS coach: ask → you answer → specific praise + correct the single most important error + one upgrade (vocabulary / connectives / ARE strategy) → retry → progress note → next question. Every third question includes a skill mini-lesson. Pronunciation errors are flagged in real time via CAPT. |

### Shadowing
Read a sentence aloud in an AI voice, then immediately repeat it. The app scores your **intonation, rhythm, and speech rate** against the model using pYIN pitch tracking + DTW-aligned MFCC comparison, with a dual pitch-contour chart.

### Progress Dashboard
Interactive band-score chart across all conversation sessions (Overall + four IELTS criteria), with per-series toggling.

### PDF Export
Print or save any session report as a PDF directly from the browser.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite 6, Web Audio API |
| **Backend** | Python 3.11, FastAPI, Uvicorn |
| **Pronunciation model** | `facebook/wav2vec2-xlsr-53-espeak-cv-ft` (CTC, IPA phonemes) |
| **STT** | OpenAI Whisper large-v3-turbo (via OpenRouter) |
| **LLM** | Google Gemini 3.1 Flash Lite (via OpenRouter) |
| **TTS** | Google Gemini 3.8 Flash Lite TTS, PCM 24 kHz (via OpenRouter) |
| **Pitch / prosody** | librosa pYIN, DTW on MFCC |

---

## Prerequisites

- Python 3.10 or later
- Node.js 18 or later
- CUDA-capable GPU recommended (CPU works via automatic int8 quantisation, but inference is slower)
- [OpenRouter](https://openrouter.ai) API key (for the AI Conversation and Shadowing features)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/hoangvu1806/IELTS_speaking_mockup.git
cd IELTS_speaking_mockup

# 2. Configure the backend
cp backend/.env.example backend/.env
# Edit backend/.env and paste your OPENROUTER_API_KEY

# 3. Start everything (Windows)
start.bat
```

`start.bat` opens two terminal windows: the FastAPI backend on **port 8000** and the Vite dev server on **port 5173**. The first run downloads the ~1.2 GB acoustic model from Hugging Face automatically.

### Manual start

```bash
# Terminal 1 – backend
cd backend
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000

# Terminal 2 – frontend
cd frontend
npm install
npm run dev        # opens http://localhost:5173
```

---

## Configuration

All configuration lives in `backend/.env`. Copy `backend/.env.example` for a full reference. Key variables:

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | *(required)* | Your OpenRouter key |
| `LLM_MODEL` | `google/gemini-3.1-flash-lite` | Chat / feedback / report model |
| `STT_MODEL` | `openai/whisper-large-v3-turbo` | Speech-to-text model |
| `TTS_MODEL` | `google/gemini-3.8-flash-lite-tts` | Text-to-speech model |
| `TTS_VOICE_EXAM` | `Charon` | Examiner voice |
| `TTS_VOICE_CHAT` | `Aoede` | Chat / Emma voice |
| `TTS_VOICE_COACH` | `Kore` | Teacher (Anna) voice |
| `PRON_DEVICE` | `cuda` | `cpu` forces CPU + int8 quantisation |
| `PRON_FP16` | — | Set to `1` to use FP16 on GPU |
| `PRON_SAVE` | `1` | Set to `0` to disable local recording storage |

---

## Deployment (VPS)

### Backend (FastAPI)

```bash
# Install dependencies
cd backend
pip install -r requirements.txt

# Run with Gunicorn + Uvicorn workers behind Nginx
pip install gunicorn
gunicorn app:app -w 1 -k uvicorn.workers.UvicornWorker \
  --bind 127.0.0.1:8000 --timeout 120
```

> Use a single worker (`-w 1`) — the acoustic model is loaded once per worker and is large.

### Frontend (static build)

```bash
cd frontend
npm install
npm run build      # outputs to frontend/dist/
```

Serve `frontend/dist/` with Nginx (or any static host). Point the `/api` proxy to your backend.

### Nginx example

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/ielts-speaking/frontend/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to FastAPI
    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_buffering    off;   # required for streaming NDJSON / PCM audio
    }
}
```

> Add TLS via Certbot: `certbot --nginx -d your-domain.com`

---

## Project Structure

```
IELTS_speaking_mockup/
├── backend/
│   ├── app.py              # FastAPI routes and request orchestration
│   ├── conversation.py     # Conversation mode prompts and session logic
│   ├── openrouter.py       # OpenRouter client (chat / STT / TTS)
│   ├── scorer.py           # Acoustic model, GOP scoring, forced alignment
│   ├── g2p.py              # Grapheme-to-phoneme (CMUdict + g2p_en fallback)
│   ├── prosody.py          # Pitch / rhythm analysis for Shadowing
│   ├── question_bank.py    # 18 Part 1 topics + 18 Part 2 cue cards
│   ├── spelling.py         # Text normalisation helpers
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Practice.tsx       # Pronunciation practice tab
│   │   │   ├── Conversation.tsx   # AI conversation tab (all three modes)
│   │   │   ├── Shadowing.tsx      # Shadowing tab
│   │   │   ├── Progress.tsx       # Band-score chart tab
│   │   │   └── ...                # UI helpers (ScoreRing, BandChart, …)
│   │   ├── lib/
│   │   │   ├── voice.ts           # Speech synthesis, sentence splitting, filler cache
│   │   │   ├── audio.ts           # VAD-based microphone recorder
│   │   │   ├── conv.ts            # NDJSON streaming protocol helpers
│   │   │   └── ...
│   │   └── data/
│   │       ├── lessons.ts         # Lesson library (editable)
│   │       └── phonemes.ts        # Per-phoneme articulation tips
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── start.bat               # One-click launcher (Windows)
└── README.md
```

---

## How Pronunciation Scoring Works

1. **G2P** — `CMUdict` converts each word to an expected phoneme sequence; unknown words fall back to `g2p_en`. Each phoneme has an accepted variant set (British/American allophones, flap /t/, weak vowels, non-rhotic endings).
2. **Acoustic model** — `wav2vec2-xlsr-53-espeak-cv-ft` runs CTC inference over the raw waveform to produce per-frame IPA logits. Single words are repeated three times for acoustic context; longer utterances are scored in overlapping ~16-word windows.
3. **GOP (alignment-free, substitution-aware)** — For each expected phoneme, the log-likelihood of the full utterance is computed under the correct hypothesis and under the strongest competing substitution/deletion hypothesis. The log-odds ratio is passed through a sigmoid to yield a 0–100 score. The winning competitor reveals what the learner actually said.
4. **Forced alignment** — A Viterbi pass over the CTC lattice timestamps each word, used for playback highlighting and pause detection (RMS energy).

Calibration: adjust `SCORE_OFFSET` and `SCORE_SLOPE` in `backend/scorer.py`.

---

## Low-Latency AI Conversation

The conversation pipeline is cascaded (STT → LLM → TTS), not end-to-end speech-to-speech. Five techniques keep perceived latency under ~1 second:

1. **Parallel local gate + STT** — the local no-speech detector and the Whisper network call are dispatched simultaneously (removes ~100–500 ms of serial CPU/GPU compute).
2. **Connection warm-up** — TCP/TLS connections to OpenRouter are pre-established at server start, overlapping with acoustic model loading.
3. **Reduced VAD endpointing** — silence threshold tightened from 1700 ms → 1000 ms (short turns) and 4500 ms → 3200 ms (Part 2), matching natural conversational gaps.
4. **Early first TTS chunk** — the `SentenceSplitter` fires the first TTS request at the first clause boundary (≥ 45 chars) rather than waiting for a full sentence, exploiting the fact that TTS latency is nearly constant per request regardless of text length.
5. **Pre-cached backchannel fillers** — short phrases ("Hmm, let me think…") are synthesised and cached at session start. If the real reply hasn't arrived within 650 ms, the filler plays instantly (no network round-trip), then yields seamlessly to the real voice. This is the same technique Google Duplex uses to mask pipeline latency. Active in Chat and Teacher modes; the IELTS examiner stays professionally silent.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server readiness + device info |
| `POST` | `/api/analyze` | Full pronunciation analysis (word/sentence) |
| `POST` | `/api/assess` | Quick phoneme assessment |
| `POST` | `/api/conv/start` | Begin a conversation session (NDJSON stream) |
| `POST` | `/api/conv/turn` | Submit a turn: audio → NDJSON stream of transcript + AI reply |
| `GET` | `/api/conv/analysis/{job_id}` | Poll CAPT result for a turn |
| `POST` | `/api/tts` | Non-streaming TTS (returns audio blob) |
| `POST` | `/api/tts/stream` | Streaming TTS (returns raw PCM at 24 kHz) |
| `POST` | `/api/shadow` | Shadowing: generate reference audio + score user recording |
| `GET` | `/api/bank` | Fetch question bank (topics + cue cards) |
| `POST` | `/api/conv/report` | Generate end-of-session band-score report |

---

## License

MIT — see [LICENSE](LICENSE) for details.

import io
import json
import re
import os
import time
from pathlib import Path
import threading

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import g2p
from spelling import align as align_letters
from scorer import SAMPLE_RATE, NoSpeechError, Scorer

app = FastAPI(title="Pronunciation Coach")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

state: dict = {"scorer": None, "error": None}
lock = threading.Lock()


def _load():
    try:
        g2p.preload()
        state["scorer"] = Scorer()
    except Exception as e:  # surfaced through /api/health
        state["error"] = repr(e)


threading.Thread(target=_load, daemon=True).start()


class TextIn(BaseModel):
    text: str


@app.get("/api/health")
def health():
    s = state["scorer"]
    return {"ready": s is not None, "device": s.device if s else None, "error": state["error"]}


@app.post("/api/analyze")
def analyze(body: TextIn):
    words = g2p.analyze(body.text)
    return {"words": [{
        "text": w.text, "start_char": w.start, "end_char": w.end, "oov": w.oov,
        "ipa": g2p.word_ipa(w.prons[0]) if w.prons else "",
        "phones": [{"arpa": s.arpa, "ipa": s.ipa} for s in w.prons[0]] if w.prons else [],
        "letters": align_letters(w.text, tuple(s.arpa for s in w.prons[0])) if w.prons else [],
    } for w in words]}


def _read_audio(data: bytes) -> np.ndarray:
    try:
        wav, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception:
        raise HTTPException(400, "Không đọc được file âm thanh (cần WAV/FLAC/OGG).")
    wav = wav.mean(1)
    if sr != SAMPLE_RATE:
        import librosa
        wav = librosa.resample(wav, orig_sr=sr, target_sr=SAMPLE_RATE)
    return wav


@app.post("/api/assess")
def assess(text: str = Form(...), audio: UploadFile = File(...)):
    s = state["scorer"]
    if s is None:
        raise HTTPException(503, "Hệ thống đang khởi động, vui lòng đợi vài giây...")
    wav = _read_audio(audio.file.read())
    if len(wav) < SAMPLE_RATE * 0.3:
        raise HTTPException(400, "Bản ghi quá ngắn.")
    if len(wav) > SAMPLE_RATE * 40:
        raise HTTPException(400, "Bản ghi quá dài (tối đa 40 giây).")
    words = g2p.analyze(text)
    try:
        with lock:  # one GPU job at a time
            result = s.assess(wav, words)
    except NoSpeechError as e:
        raise HTTPException(422, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    _keep_recording(wav, text, result)
    return result


REC_DIR = Path(__file__).parent / "recordings"
REC_KEEP = 100


def _keep_recording(wav: np.ndarray, text: str, result: dict):
    """Keep the latest takes on disk (local only) for re-calibrating the scorer. PRON_SAVE=0 disables."""
    if os.environ.get("PRON_SAVE") == "0":
        return
    try:
        REC_DIR.mkdir(exist_ok=True)
        stem = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        sf.write(REC_DIR / f"{stem}.wav", wav, SAMPLE_RATE, subtype="PCM_16")
        (REC_DIR / f"{stem}.json").write_text(json.dumps({"text": text, "result": result}, ensure_ascii=False), "utf-8")
        for old in sorted(REC_DIR.glob("*.wav"))[:-REC_KEEP]:
            old.unlink(missing_ok=True)
            old.with_suffix(".json").unlink(missing_ok=True)
    except OSError:
        pass


# ====================================================================== AI conversation
import uuid
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor

from fastapi.responses import Response, StreamingResponse

import conversation
import question_bank
import openrouter as orr

executor = ThreadPoolExecutor(max_workers=4)
# warms the OpenRouter connections while the (slower) local model loads on the thread above,
# so the first AI-conversation turn of a session doesn't pay a cold TLS handshake
threading.Thread(target=orr.warm_up, daemon=True).start()
jobs: "OrderedDict[str, Future]" = OrderedDict()
tts_cache: "OrderedDict[tuple, bytes]" = OrderedDict()


class StartIn(BaseModel):
    mode: str
    settings: dict = {}


class TtsIn(BaseModel):
    text: str
    voice: str | None = None
    mode: str = "chat"


class ReportIn(BaseModel):
    mode: str
    history: list[dict]
    pron_summary: dict = {}


def _or_call(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except orr.OpenRouterError as e:
        raise HTTPException(502, str(e))


@app.get("/api/bank")
def bank():
    return question_bank.summary()


@app.get("/api/conv/config")
def conv_config():
    return {"configured": orr.configured(), "llm": orr.LLM_MODEL, "stt": orr.STT_MODEL, "tts": orr.TTS_MODEL,
            "voice_exam": orr.TTS_VOICE_EXAM, "voice_chat": orr.TTS_VOICE_CHAT, "voice_coach": orr.TTS_VOICE_COACH}


def _ndjson(first: dict | None, mode: str, history: list[dict], settings: dict, note: str | None = None):
    """NDJSON event stream: [first event], meta, delta..., done (or error)."""
    def gen():
        if first:
            yield json.dumps(first, ensure_ascii=False) + "\n"
        text = ""
        try:
            for kind, val in conversation.reply_stream(mode, history, settings, note):
                if kind == "meta":
                    yield json.dumps({"type": "meta", **val}, ensure_ascii=False) + "\n"
                else:
                    text += val
                    yield json.dumps({"type": "delta", "text": val}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "done", "reply": text.strip().rstrip('"”').strip()}, ensure_ascii=False) + "\n"
        except orr.OpenRouterError as e:
            yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"
    # no-transform: stop proxies (and Vite) from buffering the stream
    return StreamingResponse(gen(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.post("/api/conv/start")
def conv_start(body: StartIn):
    settings = dict(body.settings)
    if body.mode == "ielts":
        settings["exam"] = conversation.new_exam_config(settings.get("card_id"), settings.get("p1_topic"))
    return _ndjson({"type": "settings", "settings": settings}, body.mode, [], settings)


def _capt(wav: np.ndarray, transcript: str) -> tuple[dict | None, str | None]:
    s = state["scorer"]
    if s is None:
        return None, None
    try:
        with lock:
            return s.assess(wav, g2p.analyze(transcript)), None
    except (NoSpeechError, ValueError) as e:
        return None, f"Phát âm: {e}"


def _analyse(mode: str, question: str, transcript: str, wav: np.ndarray | None, pre: tuple | None = None) -> dict:
    out: dict = {"pron": None, "feedback": None, "errors": []}
    if pre is not None:  # pronunciation already scored for the teacher's reply
        out["pron"], err = pre
        if err:
            out["errors"].append(err)
        wav = None
    s = state["scorer"]
    if wav is not None and s is not None:
        try:
            with lock:
                out["pron"] = s.assess(wav, g2p.analyze(transcript))
        except (NoSpeechError, ValueError) as e:
            out["errors"].append(f"Phát âm: {e}")
    try:
        out["feedback"] = conversation.feedback(mode, question, transcript, out["pron"])
    except orr.OpenRouterError as e:
        out["errors"].append(f"Nhận xét: {e}")
    return out


# Whisper invents these on near-silent audio
HALLUCINATIONS = {
    "you", "thank you", "thank you very much", "thanks", "thanks for watching", "thank you for watching",
    "thanks for watching and see you next time", "bye", "bye bye", "okay", "ok", "so", "yeah", "hmm",
    "please subscribe", "subscribe", "i'm sorry", "oh", "uh", "um",
}


def _speech_phones(wav: np.ndarray) -> int | None:
    """Number of phonemes the local wav2vec2 model actually hears (None if not loaded yet)."""
    s = state["scorer"]
    if s is None:
        return None
    with lock:
        return len(s.greedy(s.emissions_long(wav)))


def _looks_hallucinated(transcript: str, phones: int | None) -> bool:
    words = re.findall(r"[a-zA-Z']+", transcript.lower())
    if not words:
        return True
    if phones is None:
        return False
    norm = " ".join(words)
    if norm in HALLUCINATIONS and phones < 10:
        return True
    # real speech yields at least ~one phoneme per word; far fewer means invented text
    return phones < max(3, len(words) // 2)


@app.post("/api/conv/turn")
def conv_turn(mode: str = Form(...), history: str = Form("[]"), settings: str = Form("{}"),
              text: str = Form(""), audio: UploadFile | None = File(None)):
    hist = json.loads(history)
    sett = json.loads(settings)
    wav = None
    transcript = text.strip()
    if audio is not None:
        wav = _read_audio(audio.file.read())
        if len(wav) < SAMPLE_RATE * 0.4:
            raise HTTPException(422, "NO_SPEECH: bản ghi quá ngắn.")
        if len(wav) > SAMPLE_RATE * 150:
            raise HTTPException(400, "Bản ghi quá dài (tối đa 2 phút 30 giây).")
        # The local no-speech/hallucination gate and the Whisper call are independent (both
        # only need `wav`): run them concurrently instead of gating the network call behind
        # the local GPU pass. This removes ~100-500ms of serial local compute from every turn.
        phones_future = executor.submit(_speech_phones, wav)
        transcript = _or_call(orr.transcribe, wav)
        phones = phones_future.result()
        if phones is not None and phones < 3:
            raise HTTPException(422, "NO_SPEECH: không phát hiện giọng nói.")
        if _looks_hallucinated(transcript, phones):
            raise HTTPException(422, "NO_SPEECH: không phát hiện giọng nói.")
    if not transcript:
        raise HTTPException(422, "NO_SPEECH: không nghe rõ bạn nói gì.")

    question = next((h.get("text", "") for h in reversed(hist) if h.get("role") == "assistant"), "")
    job_id = uuid.uuid4().hex
    # the teacher reacts to pronunciation too, so score it before the reply starts
    pre = _capt(wav, transcript) if mode == "coach" and wav is not None else None
    jobs[job_id] = executor.submit(_analyse, mode, question, transcript, wav, pre)
    while len(jobs) > 100:
        jobs.popitem(last=False)

    hist.append({"role": "user", "text": transcript})
    note = conversation.pron_note(pre[0]) if pre else None
    return _ndjson({"type": "transcript", "text": transcript, "analysis_id": job_id}, mode, hist, sett, note)


@app.get("/api/conv/analysis/{job_id}")
def conv_analysis(job_id: str):
    fut = jobs.get(job_id)
    if fut is None:
        raise HTTPException(404, "Không tìm thấy phân tích.")
    try:
        return fut.result(timeout=90)
    except TimeoutError:
        raise HTTPException(504, "Phân tích quá lâu.")


@app.post("/api/tts")
def tts(body: TtsIn):
    text = body.text.strip()[:1500]
    if not text:
        raise HTTPException(400, "Thiếu nội dung.")
    voice = body.voice or orr.voice_for(body.mode)
    key = (orr.TTS_MODEL, voice, text)
    wav = tts_cache.get(key)
    if wav is None:
        pcm_fmt = "pcm" if "gemini" in orr.TTS_MODEL else "mp3"
        data, mime = _or_call(orr.speak, text, voice, pcm_fmt)
        if mime.startswith("audio/pcm") or pcm_fmt == "pcm":
            rate = 24000
            for part in orr_last_mime_params(mime):
                if part.startswith("rate="):
                    rate = int(part[5:])
            pcm = np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2")
            buf = io.BytesIO()
            sf.write(buf, pcm, rate, format="WAV", subtype="PCM_16")
            wav, media = buf.getvalue(), "audio/wav"
        else:
            wav, media = data, mime
        tts_cache[key] = wav
        while len(tts_cache) > 200:
            tts_cache.popitem(last=False)
    media = "audio/wav" if wav[:4] == b"RIFF" else "audio/mpeg"
    return Response(content=wav, media_type=media, headers={"Cache-Control": "max-age=86400"})


def orr_last_mime_params(mime: str) -> list[str]:
    return [p.strip() for p in mime.split(";")[1:]]


pcm_cache: "OrderedDict[tuple, tuple[int, bytes]]" = OrderedDict()


@app.post("/api/tts/stream")
def tts_stream(body: TtsIn):
    """Raw 16-bit mono PCM, forwarded chunk by chunk as the provider synthesises it, so the
    browser can start playing before the sentence is fully generated. X-Sample-Rate header."""
    text = body.text.strip()[:1500]
    if not text:
        raise HTTPException(400, "Thiếu nội dung.")
    voice = body.voice or orr.voice_for(body.mode)
    key = (orr.TTS_MODEL, voice, text)
    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}
    if key in pcm_cache:
        rate, data = pcm_cache[key]
        return Response(content=data, media_type="audio/pcm", headers={**headers, "X-Sample-Rate": str(rate)})

    try:
        mime, chunks = orr.speak_stream(text, voice, "pcm")
    except orr.OpenRouterError as e:
        # models without PCM output: the client falls back to the buffered /api/tts
        raise HTTPException(415 if e.status == 400 else 502, str(e))
    if not mime.startswith("audio/pcm"):
        raise HTTPException(415, "Giọng đọc này chưa hỗ trợ phát trực tiếp.")
    rate = next((int(p[5:]) for p in orr_last_mime_params(mime) if p.startswith("rate=")), 24000)

    def gen():
        buf, carry = bytearray(), b""
        for c in chunks:
            if not c:
                continue
            c = carry + c
            even = len(c) // 2 * 2  # never split a 16-bit sample across chunks
            carry = c[even:]
            if even:
                buf += c[:even]
                yield c[:even]
        pcm_cache[key] = (rate, bytes(buf))
        while len(pcm_cache) > 200:
            pcm_cache.popitem(last=False)

    return StreamingResponse(gen(), media_type="audio/pcm", headers={**headers, "X-Sample-Rate": str(rate)})


def _reference_audio(text: str, voice: str) -> np.ndarray:
    """The AI reference voice for shadowing at 16 kHz (reuses what the browser just played)."""
    key = (orr.TTS_MODEL, voice, text)
    if key in pcm_cache:
        rate, data = pcm_cache[key]
        pcm = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
    else:
        data, mime = _or_call(orr.speak, text, voice, "pcm" if "gemini" in orr.TTS_MODEL else "mp3")
        if mime.startswith("audio/pcm"):
            rate = next((int(p[5:]) for p in orr_last_mime_params(mime) if p.startswith("rate=")), 24000)
            pcm = np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2").astype(np.float32) / 32768
            pcm_cache[key] = (rate, data[: len(data) // 2 * 2])
        else:
            pcm, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
            pcm = pcm.mean(1)
    if rate != SAMPLE_RATE:
        import librosa
        pcm = librosa.resample(pcm, orig_sr=rate, target_sr=SAMPLE_RATE)
    return pcm


@app.post("/api/shadow")
def shadow(text: str = Form(...), mode: str = Form("chat"), audio: UploadFile = File(...)):
    """Shadowing: compare the learner's intonation, rhythm and pace with the AI reference voice."""
    import prosody
    wav = _read_audio(audio.file.read())
    if len(wav) < SAMPLE_RATE * 0.4:
        raise HTTPException(400, "Bản ghi quá ngắn.")
    ref = _reference_audio(text.strip()[:1500], orr.voice_for(mode))
    return prosody.compare(ref, wav)


@app.post("/api/conv/report")
def conv_report(body: ReportIn):
    return _or_call(conversation.report, body.mode, body.history, body.pron_summary)

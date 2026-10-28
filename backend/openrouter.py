"""Thin OpenRouter client: chat (LLM), speech-to-text, text-to-speech."""
from __future__ import annotations

import base64
import io
import json
import os
import re
from pathlib import Path

import numpy as np
import requests
import soundfile as sf
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "google/gemini-3.1-flash-lite")
REPORT_MODEL = os.environ.get("LLM_REPORT_MODEL", LLM_MODEL)
STT_MODEL = os.environ.get("STT_MODEL", "openai/whisper-large-v3-turbo")
TTS_MODEL = os.environ.get("TTS_MODEL", "google/gemini-3.8-flash-lite-tts")
TTS_VOICE_EXAM = os.environ.get("TTS_VOICE_EXAM", "Charon")
TTS_VOICE_CHAT = os.environ.get("TTS_VOICE_CHAT", "Aoede")
TTS_VOICE_COACH = os.environ.get("TTS_VOICE_COACH", "Kore")


def voice_for(mode: str) -> str:
    return {"ielts": TTS_VOICE_EXAM, "coach": TTS_VOICE_COACH}.get(mode, TTS_VOICE_CHAT)

_session = requests.Session()
# a handful of TTS sentence-chunk requests can be in flight at once per host; keep the pool
# big enough that none of them queue behind the others waiting for a free connection
_adapter = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=20)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)


#  status 0 = no network reply, -1 = not configured, else the upstream HTTP status.
_FRIENDLY = {
    -1: "Tính năng này chưa được bật. Vui lòng liên hệ quản trị viên.",
    0: "Không thể kết nối tới máy chủ trò chuyện. Hãy kiểm tra kết nối mạng và thử lại.",
    401: "Không thể xác thực dịch vụ trò chuyện. Vui lòng liên hệ quản trị viên.",
    402: "Dịch vụ trò chuyện tạm thời hết hạn mức sử dụng. Vui lòng thử lại sau.",
    403: "Không có quyền truy cập dịch vụ trò chuyện. Vui lòng liên hệ quản trị viên.",
    404: "Không tìm thấy tính năng này. Vui lòng thử lại sau.",
    408: "Phản hồi quá lâu. Vui lòng thử lại.",
    429: "Hệ thống đang quá tải, vui lòng đợi một chút rồi thử lại.",
}


class OpenRouterError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail  # full technical detail - log this, don't show it to learners
        super().__init__(_FRIENDLY.get(status, _FRIENDLY[0] if status < 500 else
                          "Đã có lỗi xảy ra, vui lòng thử lại sau."))


def configured() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY", "").strip())


def _headers(json_body: bool = True) -> dict:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise OpenRouterError(-1, "OPENROUTER_API_KEY is not set in backend/.env")
    h = {"Authorization": f"Bearer {key}", "HTTP-Referer": "http://localhost:5173", "X-Title": "Luyen Phat Am"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def _error_from_response(r: requests.Response) -> OpenRouterError:
    try:
        msg = r.json().get("error", {}).get("message") or r.text
    except ValueError:
        msg = r.text
    err = OpenRouterError(r.status_code, f"OpenRouter {r.status_code}: {msg[:300]}")
    print(f"[openrouter] {err.detail}")
    return err


def _post(path: str, body: dict, timeout: float) -> requests.Response:
    try:
        r = _session.post(f"{BASE_URL}{path}", headers=_headers(), json=body, timeout=timeout)
    except requests.RequestException as e:
        print(f"[openrouter] connection error: {e}")
        raise OpenRouterError(0, str(e)) from e
    if r.status_code >= 400:
        raise _error_from_response(r)
    return r


def chat(messages: list[dict], *, model: str | None = None, temperature: float = 0.7,
         max_tokens: int = 1200, json_mode: bool = False, timeout: float = 60) -> str:
    body = {"model": model or LLM_MODEL, "messages": messages, "temperature": temperature,
            "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    data = _post("/chat/completions", body, timeout).json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError) as e:
        print(f"[openrouter] invalid chat response: {str(data)[:300]}")
        raise OpenRouterError(500, f"invalid chat response: {str(data)[:300]}") from e


def _post_stream(path: str, body: dict, timeout: float) -> requests.Response:
    try:
        r = _session.post(f"{BASE_URL}{path}", headers=_headers(), json=body, timeout=timeout, stream=True)
    except requests.RequestException as e:
        print(f"[openrouter] connection error: {e}")
        raise OpenRouterError(0, str(e)) from e
    if r.status_code >= 400:
        raise _error_from_response(r)
    return r


def chat_stream(messages: list[dict], *, model: str | None = None, temperature: float = 0.7,
                max_tokens: int = 400, timeout: float = 60):
    """Yield text deltas as the model writes them (SSE)."""
    body = {"model": model or LLM_MODEL, "messages": messages, "temperature": temperature,
            "max_tokens": max_tokens, "stream": True}
    r = _post_stream("/chat/completions", body, timeout)
    r.encoding = "utf-8"
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue  # keep-alive comments (": OPENROUTER PROCESSING")
        data = line[6:]
        if data == "[DONE]":
            break
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            continue
        if "error" in obj:
            e = obj["error"]
            status = e.get("code") if isinstance(e, dict) else 500
            status = status if isinstance(status, int) else 500
            detail = str(e.get("message", e)) if isinstance(e, dict) else str(e)
            print(f"[openrouter] stream error: {detail[:300]}")
            raise OpenRouterError(status, detail[:300])
        delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content")
        if delta:
            yield delta


def speak_stream(text: str, voice: str, fmt: str = "pcm"):
    """Returns (content-type, iterator of audio byte chunks) as they arrive from the provider."""
    body = {"model": TTS_MODEL, "input": text, "voice": voice, "response_format": fmt}
    r = _post_stream("/audio/speech", body, timeout=60)
    return r.headers.get("Content-Type", "audio/pcm;rate=24000"), r.iter_content(chunk_size=4800)


def chat_json(messages: list[dict], **kw) -> dict:
    """Chat that must return a JSON object; tolerant of code fences / stray text."""
    text = chat(messages, json_mode=True, **kw)
    return parse_json(text)


def parse_json(text: str) -> dict:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    print(f"[openrouter] invalid JSON from chat_json: {text[:300]}")
    raise OpenRouterError(500, f"invalid JSON from chat_json: {text[:300]}")


def transcribe(wav: np.ndarray, sample_rate: int = 16000, language: str = "en") -> str:
    buf = io.BytesIO()
    sf.write(buf, wav, sample_rate, format="WAV", subtype="PCM_16")
    body = {"model": STT_MODEL, "language": language, "temperature": 0,
            "input_audio": {"data": base64.b64encode(buf.getvalue()).decode(), "format": "wav"}}
    return (_post("/audio/transcriptions", body, timeout=60).json().get("text") or "").strip()


def speak(text: str, voice: str, fmt: str = "mp3") -> tuple[bytes, str]:
    """Returns (audio bytes, full Content-Type, e.g. "audio/pcm;rate=24000;channels=1")."""
    body = {"model": TTS_MODEL, "input": text, "voice": voice, "response_format": fmt}
    r = _post("/audio/speech", body, timeout=60)
    return r.content, r.headers.get("Content-Type", "audio/mpeg")


def warm_up():
    """Best-effort: open the TCP+TLS connections to OpenRouter's chat and audio endpoints
    before the first real request, so a learner's first turn doesn't pay that setup cost.
    Runs during server startup, overlapped with loading the local pronunciation model."""
    if not configured():
        return
    for fn in (
        lambda: chat([{"role": "user", "content": "hi"}], max_tokens=1),
        lambda: speak(".", TTS_VOICE_CHAT, "pcm" if "gemini" in TTS_MODEL else "mp3"),
    ):
        try:
            fn()
        except Exception as e:
            print(f"[openrouter] warm-up call failed (non-fatal): {e}")

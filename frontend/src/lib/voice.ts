import { ttsBlob, type Mode } from './conv'

/** Incremental sentence splitter for streamed LLM text: emits each sentence as soon as it
 *  is complete, so speech synthesis can start while the model is still writing. The very
 *  first chunk is cut more eagerly (at a comma/short clause) since TTS latency is roughly
 *  fixed per request regardless of text length - the sooner that first request fires, the
 *  sooner the reply is audible. Later chunks use full sentences, which sound more natural
 *  and have already been pipelined (fetched in parallel) by the time they're needed. */
export class SentenceSplitter {
  private buf = ''
  private firstDone = false

  push(text: string): string[] {
    this.buf += text
    const out: string[] = []
    for (;;) {
      const m = /[.!?…]+["'”’)\]]?\s+/.exec(this.buf)
      let cut = m ? m.index + m[0].length : -1
      if (cut < 0 && !this.firstDone && this.buf.length > 45) {
        // first chunk only: an early clause boundary beats waiting for the full sentence
        const c = /[,;:]\s+|\s(?:and|but|because|so|although|while)\s/i.exec(this.buf.slice(20))
        if (c) cut = 20 + c.index + c[0].length
      }
      // very long clause without a full stop: break at a comma so audio is not delayed
      if (cut < 0 && this.buf.length > 160) {
        const c = this.buf.lastIndexOf(', ', 150)
        if (c > 50) cut = c + 2
      }
      if (cut < 0) break
      const s = this.buf.slice(0, cut).trim()
      this.buf = this.buf.slice(cut)
      if (s) {
        out.push(s)
        this.firstDone = true
      }
    }
    return out
  }

  flush(): string[] {
    const s = this.buf.trim()
    this.buf = ''
    return s ? [s] : []
  }
}

export function splitForSpeech(text: string): string[] {
  const sp = new SentenceSplitter()
  return [...sp.push(text + ' '), ...sp.flush()]
}

interface Clip {
  rate: number
  chunks: Float32Array[]
  done: boolean
  error?: unknown
}

// finished clips, so replaying a message is instant and free
const clipCache = new Map<string, Clip>()
const cacheKey = (mode: Mode, text: string) => `${mode}|${text}`

function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

/** Fetches and decodes one clip, writing it into `clipCache` as it fills in (so a consumer
 *  reading the cache mid-fetch still sees chunks arrive). Shared by Speech and warmClip(). */
async function loadClip(text: string, mode: Mode, player: VoicePlayer, signal?: AbortSignal): Promise<Clip> {
  const key = cacheKey(mode, text)
  const existing = clipCache.get(key)
  if (existing) return existing
  const clip: Clip = { rate: 24000, chunks: [], done: false }
  clipCache.set(key, clip)
  try {
    const res = await fetch('/api/tts/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode }), signal,
    })
    if (res.status === 415) {
      // provider without PCM streaming: fetch the whole file and decode it
      const blob = await ttsBlob(text, mode)
      const audio = await player.ctx.decodeAudioData(await blob.arrayBuffer())
      clip.rate = audio.sampleRate
      clip.chunks.push(audio.getChannelData(0).slice())
    } else {
      if (!res.ok || !res.body) throw new Error(`TTS lỗi (${res.status})`)
      clip.rate = Number(res.headers.get('X-Sample-Rate')) || 24000
      const reader = res.body.getReader()
      let carry = new Uint8Array(0)
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        let bytes = value
        if (carry.length) {
          bytes = new Uint8Array(carry.length + value.length)
          bytes.set(carry)
          bytes.set(value, carry.length)
        }
        const even = bytes.length & ~1
        carry = bytes.slice(even)
        if (even) clip.chunks.push(pcm16ToFloat(bytes.subarray(0, even)))
      }
    }
  } catch (e) {
    clip.error = e
    clipCache.delete(key) // don't poison the cache with a failed attempt
  } finally {
    clip.done = true
  }
  return clip
}

/** Pre-synthesise and cache a short phrase (e.g. a conversational filler) well ahead of when
 *  it might be needed, so playing it later is instant - no network round trip in the way. */
export function warmClip(text: string, mode: Mode, player: VoicePlayer) {
  if (!clipCache.has(cacheKey(mode, text))) void loadClip(text, mode, player)
}

/** A warmed phrase ready to play right now (fully fetched, no error), or null if none of the
 *  given candidates are ready yet. Used to pick a backchannel filler while the real reply
 *  is still being generated - exactly like a human saying "hmm" while they think. */
export function readyFiller(texts: string[], mode: Mode): string | null {
  const ready = texts.filter((t) => {
    const c = clipCache.get(cacheKey(mode, t))
    return c && c.done && !c.error && c.chunks.length
  })
  return ready.length ? ready[Math.floor(Math.random() * ready.length)] : null
}

/** One spoken assistant message: sentences are pushed while the text streams in; each is
 *  synthesised immediately (in parallel) and its PCM chunks are scheduled gaplessly in order. */
export class Speech {
  private clips: Clip[] = []
  private closed = false
  private stopped = false
  private abort = new AbortController()
  private sources = new Set<AudioBufferSourceNode>()
  private wakeResolve: () => void = () => {}
  private wake = new Promise<void>((r) => (this.wakeResolve = r))
  readonly done: Promise<boolean>
  private player: VoicePlayer
  private mode: Mode
  private started = false
  /** called once, when the first audio chunk actually starts playing */
  onStart: () => void = () => {}

  constructor(player: VoicePlayer, mode: Mode) {
    this.player = player
    this.mode = mode
    this.done = this.run()
  }

  private signal() {
    const r = this.wakeResolve
    this.wake = new Promise<void>((res) => (this.wakeResolve = res))
    r()
  }

  push(sentence: string) {
    if (this.stopped || !sentence.trim()) return
    const key = `${this.mode}|${sentence}`
    const cached = clipCache.get(key)
    if (cached) {
      this.clips.push(cached)
      this.signal()
      return
    }
    const clip: Clip = { rate: 24000, chunks: [], done: false }
    this.clips.push(clip)
    this.signal()
    void this.fetchClip(sentence, clip, key)
  }

  close() {
    this.closed = true
    this.signal()
  }

  stop() {
    this.stopped = true
    this.abort.abort()
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear()
    this.signal()
  }

  private async fetchClip(text: string, clip: Clip, key: string) {
    try {
      const res = await fetch('/api/tts/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode: this.mode }), signal: this.abort.signal,
      })
      if (res.status === 415) {
        // provider without PCM streaming: fetch the whole file and decode it
        const blob = await ttsBlob(text, this.mode)
        const audio = await this.player.ctx.decodeAudioData(await blob.arrayBuffer())
        clip.rate = audio.sampleRate
        clip.chunks.push(audio.getChannelData(0).slice())
      } else {
        if (!res.ok || !res.body) throw new Error(`TTS lỗi (${res.status})`)
        clip.rate = Number(res.headers.get('X-Sample-Rate')) || 24000
        const reader = res.body.getReader()
        let carry = new Uint8Array(0)
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          let bytes = value
          if (carry.length) {
            bytes = new Uint8Array(carry.length + value.length)
            bytes.set(carry)
            bytes.set(value, carry.length)
          }
          const even = bytes.length & ~1
          carry = bytes.slice(even)
          if (even) {
            clip.chunks.push(pcm16ToFloat(bytes.subarray(0, even)))
            this.signal()
          }
        }
      }
      if (!this.stopped) clipCache.set(key, clip)
    } catch (e) {
      if (!this.stopped) clip.error = e
    } finally {
      clip.done = true
      this.signal()
    }
  }

  private schedule(samples: Float32Array, rate: number) {
    const ctx = this.player.ctx
    const buf = ctx.createBuffer(1, samples.length, rate)
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.player.analyser)
    // after an underrun, leave a small lead so the next chunks can line up behind it
    const at = Math.max(this.player.playhead, ctx.currentTime + 0.06)
    src.start(at)
    this.player.playhead = at + buf.duration
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
    if (!this.started) {
      this.started = true
      window.setTimeout(() => !this.stopped && this.onStart(), Math.max(0, (at - ctx.currentTime) * 1000))
    }
  }

  private async run(): Promise<boolean> {
    await this.player.ctx.resume().catch(() => {})
    let idx = 0
    while (!this.stopped) {
      if (idx >= this.clips.length) {
        if (this.closed) break
        await this.wake
        continue
      }
      const clip = this.clips[idx]
      let ci = 0
      while (!this.stopped) {
        if (ci < clip.chunks.length) {
          this.schedule(clip.chunks[ci++], clip.rate)
        } else if (clip.done) {
          break
        } else {
          await this.wake
        }
      }
      if (clip.error) throw clip.error
      idx++
    }
    // wait for the scheduled audio to finish playing
    while (!this.stopped && this.player.ctx.currentTime < this.player.playhead - 0.02) {
      await new Promise((r) => setTimeout(r, 60))
    }
    return !this.stopped
  }
}

/** Plays assistant speech; exposes the output level for visualisations. */
export class VoicePlayer {
  readonly ctx = new AudioContext()
  readonly analyser: AnalyserNode
  playhead = 0
  private current: Speech | null = null
  private levelBuf: Float32Array<ArrayBuffer>
  onChange: (playingId: string | null) => void = () => {}

  constructor() {
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.connect(this.ctx.destination)
    this.levelBuf = new Float32Array(this.analyser.fftSize)
  }

  /** Start a (streamed) utterance; push sentences into it as they arrive. */
  begin(id: string, mode: Mode): Speech {
    this.stop()
    this.playhead = 0
    const sp = new Speech(this, mode)
    this.current = sp
    sp.onStart = () => this.current === sp && this.onChange(id)
    sp.done.catch(() => false).finally(() => {
      if (this.current === sp) {
        this.current = null
        this.onChange(null)
      }
    })
    return sp
  }

  /** Speak a complete text. Resolves true if it finished, false if stopped. */
  play(id: string, text: string, mode: Mode): Promise<boolean> {
    const sp = this.begin(id, mode)
    for (const s of splitForSpeech(text)) sp.push(s)
    sp.close()
    return sp.done
  }

  stop() {
    const cur = this.current
    this.current = null
    cur?.stop()
    if (cur) this.onChange(null)
  }

  /** Current output loudness 0..1 (for the speaking animation). */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.levelBuf)
    let sum = 0
    for (const v of this.levelBuf) sum += v * v
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 5)
  }
}

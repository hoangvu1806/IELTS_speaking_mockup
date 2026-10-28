export const SAMPLE_RATE = 16000

let sharedCtx: AudioContext | null = null
function ctx() {
  if (!sharedCtx) sharedCtx = new AudioContext()
  if (sharedCtx.state === 'suspended') void sharedCtx.resume()
  return sharedCtx
}

export interface VadOptions {
  /** silence after speech that ends the take */
  silenceMs: number
  onSpeechStart?: () => void
  /** a burst that looked like speech turned out too short (cough, click, echo) - still listening */
  onFalseStart?: () => void
  onSpeechEnd?: () => void
  /** no speech at all within this time */
  noSpeechMs?: number
  onNoSpeech?: () => void
  /** total voiced time required before a take is accepted (default 500 ms; lower for single words) */
  minUtterMs?: number
  /** sustained voiced energy needed to call it speech (default 240 ms; lower for single words,
   *  where only the vowel clears the speech band - "think" voices for barely 200 ms) */
  minStartMs?: number
}

export interface RecorderOptions {
  /** cancel speaker output picked up by the mic (needed when the AI talks through speakers) */
  echoCancellation?: boolean
}

const TICK_MS = 30
const WARMUP_MS = 150      // ignore the first moments while auto-gain settles
const CALIBRATE_MS = 500   // then measure the background noise floor
const MIN_START_MS = 240   // sustained voiced energy needed to call it speech
const MIN_UTTER_MS = 500   // total voiced time needed before a take is sent
const VOICE_BAND_RATIO = 0.55 // share of energy in the 250-3500 Hz speech band
const NOISE_MAX = 0.03     // a real room floor never reaches this: above it we measured a voice
const DEBUG = (() => {
  try {
    return localStorage.getItem('vad-debug') === '1'
  } catch {
    return false
  }
})()

export class Recorder {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private timer = 0

  async start(onLevel: (level: number) => void, vad?: VadOptions, opts: RecorderOptions = {}) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: !!opts.echoCancellation, noiseSuppression: true, autoGainControl: true },
    })
    const source = ctx().createMediaStreamSource(this.stream)
    const analyser = ctx().createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const spec = new Float32Array(analyser.frequencyBinCount)
    const binHz = ctx().sampleRate / analyser.fftSize
    const bandLo = Math.floor(250 / binHz), bandHi = Math.ceil(3500 / binHz)
    /** share of spectral energy inside the speech band: low for fans/hum, low for clicks */
    const voiceRatio = () => {
      analyser.getFloatFrequencyData(spec)
      let band = 0, total = 0
      for (let i = 1; i < spec.length; i++) {
        const p = 10 ** (spec[i] / 10)
        total += p
        if (i >= bandLo && i <= bandHi) band += p
      }
      return total > 0 ? band / total : 0
    }

    // Energy + spectral VAD with a robust noise floor, hysteresis and a minimum utterance
    // length, so coughs, keyboard clicks, fan noise or the tail of the AI voice are ignored.
    const t0 = performance.now()
    const calib: number[] = []
    let noise = 0
    let voicedMs = 0, voicedTotal = 0, silentMs = 0, speaking = false, done = false
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      const rms = Math.sqrt(sum / buf.length)
      onLevel(Math.min(1, rms * 6))
      if (!vad || done) return

      const t = performance.now() - t0
      if (t < WARMUP_MS) return
      if (t < WARMUP_MS + CALIBRATE_MS) {
        calib.push(rms)
        return
      }
      if (calib.length) {
        calib.sort((a, b) => a - b)
        // 20th percentile rather than the median: learners routinely start talking inside the
        // calibration window, and a median then measures their voice instead of the room.
        noise = Math.min(calib[Math.floor(calib.length * 0.2)], NOISE_MAX)
        calib.length = 0
      }
      const on = Math.max(0.02, noise * 3.5)    // enter speech
      const off = Math.max(0.012, noise * 2.2)  // leave speech
      const voiced = rms > on && voiceRatio() > VOICE_BAND_RATIO
      if (DEBUG) console.log(`vad t=${t.toFixed(0)} rms=${rms.toFixed(4)} noise=${noise.toFixed(4)} on=${on.toFixed(4)} voiced=${voiced} speaking=${speaking} total=${voicedTotal}`)
      if (!speaking) {
        voicedMs = voiced ? voicedMs + TICK_MS : Math.max(0, voicedMs - 2 * TICK_MS)
        if (voicedMs >= (vad.minStartMs ?? MIN_START_MS)) {
          speaking = true
          silentMs = 0
          voicedTotal = voicedMs
          vad.onSpeechStart?.()
        } else {
          // Minimum statistics: fall fast to any new low, rise only by a crawl. Speech always
          // sits above the floor, so it can no longer drag the floor up behind it and lock
          // itself out - the old rule let a loud start pin the threshold past the timeout.
          noise = Math.min(rms < noise ? noise * 0.7 + rms * 0.3 : noise * 1.001, NOISE_MAX)
        }
        if (!speaking && vad.noSpeechMs && t > vad.noSpeechMs) {
          done = true
          vad.onNoSpeech?.()
        }
      } else {
        if (voiced) voicedTotal += TICK_MS
        silentMs = rms < off ? silentMs + TICK_MS : 0
        if (silentMs >= vad.silenceMs) {
          if (voicedTotal >= (vad.minUtterMs ?? MIN_UTTER_MS)) {
            done = true
            vad.onSpeechEnd?.()
          } else {
            // too little actual voice: a false start, keep listening
            speaking = false
            voicedMs = 0
            voicedTotal = 0
            vad.onFalseStart?.()
          }
        }
      }
    }
    this.timer = window.setInterval(tick, TICK_MS)

    this.chunks = []
    this.rec = new MediaRecorder(this.stream)
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.start()
  }

  stop(): Promise<Float32Array> {
    clearInterval(this.timer)
    return new Promise((resolve, reject) => {
      if (!this.rec) return reject(new Error('not recording'))
      this.rec.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop())
        try {
          const blob = new Blob(this.chunks, { type: this.rec?.mimeType })
          resolve(await decodeTo16k(blob))
        } catch (e) {
          reject(e)
        }
      }
      this.rec.stop()
    })
  }

  cancel() {
    clearInterval(this.timer)
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop()
    this.stream?.getTracks().forEach((t) => t.stop())
  }
}

/** Decode any browser-recorded blob and resample to 16 kHz mono. */
export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const decoded = await ctx().decodeAudioData(await blob.arrayBuffer())
  const length = Math.ceil(decoded.duration * SAMPLE_RATE)
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0).slice()
}

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

let current: AudioBufferSourceNode | null = null

/** Play the recording, optionally only the [start, end] seconds window. */
export function playSamples(samples: Float32Array, start = 0, end?: number) {
  current?.stop()
  const c = ctx()
  const buf = c.createBuffer(1, samples.length, SAMPLE_RATE)
  buf.copyToChannel(new Float32Array(samples), 0)
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(c.destination)
  src.start(0, start, end !== undefined ? end - start : undefined)
  current = src
}

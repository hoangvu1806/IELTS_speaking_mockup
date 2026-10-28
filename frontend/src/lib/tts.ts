export type Accent = 'en-US' | 'en-GB'

function pickVoice(accent: Accent): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith(accent))
  const rank = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1)
  return voices.sort((a, b) => rank(b) - rank(a))[0]
}

// voices load asynchronously in Chrome
if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices()

export function speak(text: string, accent: Accent, rate = 1) {
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = accent
  u.rate = rate
  const v = pickVoice(accent)
  if (v) u.voice = v
  speechSynthesis.speak(u)
}

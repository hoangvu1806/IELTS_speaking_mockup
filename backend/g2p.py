"""Text -> expected phoneme slots.

CMUdict (ARPAbet) gives the canonical pronunciation. Each ARPAbet phone becomes a
"slot" holding the set of model (espeak-IPA) tokens we accept for it, so that
British/American variants, flapped /t/, reduced vowels, etc. are not penalised.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field

from nltk.corpus import cmudict

# --- ARPAbet -> tokens of facebook/wav2vec2-lv-60-espeak-cv-ft that count as correct.
# Keys ending in "0" are used for unstressed vowels (more lenient: reductions are natural).
ACCEPT: dict[str, list[str]] = {
    "AA": ["ɑː", "ɑ", "ɒ", "ɔ"],
    "AE": ["æ", "a"],
    "AH": ["ʌ", "ɐ", "ə"],
    "AH0": ["ə", "ɐ", "ɪ", "ᵻ", "ʌ"],
    "AO": ["ɔː", "ɔ", "ɑː", "ɒ", "ɑ"],
    "AW": ["aʊ"],
    "AY": ["aɪ"],
    "EH": ["ɛ", "e"],
    "ER": ["ɜː", "ɚ", "ɜ"],
    "ER0": ["ɚ", "ə", "ɐ"],
    "EY": ["eɪ", "e"],
    "IH": ["ɪ", "ᵻ"],
    "IH0": ["ɪ", "ᵻ", "ə", "i"],
    "IY": ["iː", "i"],
    "IY0": ["i", "iː", "ɪ"],
    "OW": ["oʊ", "əʊ", "o"],
    "OY": ["ɔɪ"],
    "UH": ["ʊ"],
    "UW": ["uː", "u"],
    "UW0": ["u", "uː", "ʊ", "ə"],
    "B": ["b"], "CH": ["tʃ"], "D": ["d", "ɾ"], "DH": ["ð"], "F": ["f"], "G": ["ɡ"],
    "HH": ["h"], "JH": ["dʒ"], "K": ["k"], "L": ["l", "ɫ"], "M": ["m"], "N": ["n"],
    "NG": ["ŋ"], "P": ["p"], "R": ["ɹ", "r"], "S": ["s"], "SH": ["ʃ"],
    "T": ["t", "ɾ", "ʔ"], "TH": ["θ"], "V": ["v"], "W": ["w"], "Y": ["j"],
    "Z": ["z"], "ZH": ["ʒ"],
}

# espeak fuses vowel+r into one token; accept the fused token on both slots.
R_FUSED = {
    "AA": ["ɑːɹ"], "AO": ["ɔːɹ", "oːɹ"], "OW": ["oːɹ", "ɔːɹ"], "IH": ["ɪɹ", "iə"],
    "IY": ["ɪɹ", "iə"], "EH": ["ɛɹ", "eə"], "EY": ["ɛɹ", "eə"], "UH": ["ʊɹ", "ʊə"],
    "UW": ["ʊɹ", "ʊə"], "AY": ["aɪɚ", "aɪə"],
}

# Dictionary-style IPA for display.
DISPLAY = {
    "AA": "ɑː", "AE": "æ", "AH": "ʌ", "AH0": "ə", "AO": "ɔː", "AW": "aʊ", "AY": "aɪ",
    "EH": "e", "ER": "ɝː", "ER0": "ɚ", "EY": "eɪ", "IH": "ɪ", "IY": "iː", "IY0": "i",
    "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "uː", "UW0": "u",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "g", "HH": "h",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "r", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}

# Legal English onsets, used to place the stress mark before the right consonant.
ONSETS = {
    ("P", "L"), ("P", "R"), ("B", "L"), ("B", "R"), ("T", "R"), ("D", "R"), ("K", "L"),
    ("K", "R"), ("K", "W"), ("G", "L"), ("G", "R"), ("F", "L"), ("F", "R"), ("TH", "R"),
    ("SH", "R"), ("S", "P"), ("S", "T"), ("S", "K"), ("S", "M"), ("S", "N"), ("S", "L"),
    ("S", "W"), ("T", "W"), ("D", "W"), ("P", "Y"), ("B", "Y"), ("K", "Y"), ("F", "Y"),
    ("M", "Y"), ("HH", "Y"), ("V", "Y"), ("S", "P", "R"), ("S", "T", "R"), ("S", "K", "R"),
    ("S", "P", "L"), ("S", "K", "W"), ("S", "K", "Y"), ("S", "P", "Y"),
}


@dataclass
class Slot:
    arpa: str            # e.g. "TH", "IY"
    stress: int | None   # vowel stress (0/1/2), None for consonants
    ipa: str             # display IPA
    accept: list[str]    # model tokens counted as correct
    optional: bool = False  # may be dropped without penalty (non-rhotic r)


@dataclass
class WordPron:
    text: str
    start: int           # char offsets in the original text
    end: int
    prons: list[list[Slot]] = field(default_factory=list)  # empty => out of vocabulary

    @property
    def oov(self) -> bool:
        return not self.prons


_cmu: dict[str, list[list[str]]] | None = None
_g2p_fallback = None
# NLTK's lazy corpus loader is not thread-safe; concurrent first requests must not race
_cmu_lock = threading.Lock()


def _dict() -> dict[str, list[list[str]]]:
    global _cmu
    if _cmu is None:
        with _cmu_lock:
            if _cmu is None:
                try:
                    _cmu = cmudict.dict()
                except LookupError:
                    import nltk
                    nltk.download("cmudict", quiet=True)
                    _cmu = cmudict.dict()
    return _cmu


def preload():
    """Load the pronunciation dictionary (and neural G2P) up front."""
    _dict()
    _fallback("hello")


def _fallback(word: str) -> list[str] | None:
    """Neural G2P for words missing from CMUdict (optional dependency g2p_en)."""
    global _g2p_fallback
    if _g2p_fallback is None:
        with _cmu_lock:
            if _g2p_fallback is None:
                try:
                    from g2p_en import G2p
                    _g2p_fallback = G2p()
                except Exception:
                    _g2p_fallback = False
    if not _g2p_fallback:
        return None
    with _cmu_lock:  # the neural G2P model is not safe to call from several threads
        out = _g2p_fallback(word)
    phones = [p for p in out if re.fullmatch(r"[A-Z]+[012]?", p)]
    return phones or None


def arpa_to_slots(phones: list[str]) -> list[Slot]:
    base = [re.sub(r"\d", "", p) for p in phones]
    stress = [int(p[-1]) if p[-1].isdigit() else None for p in phones]
    slots: list[Slot] = []
    for i, (b, s) in enumerate(zip(base, stress)):
        key = b + "0" if s == 0 and b + "0" in ACCEPT else b
        accept = list(ACCEPT[key])
        optional = False
        prev_b = base[i - 1] if i else None
        next_b = base[i + 1] if i + 1 < len(base) else None
        if b in R_FUSED and next_b == "R":
            accept += R_FUSED[b]
        if b == "R" and prev_b in R_FUSED:
            accept += R_FUSED[prev_b]
            # post-vocalic r before a consonant / word end: British English drops it
            optional = next_b is None or next_b not in VOWELS
        if b == "AH" and s == 0 and next_b == "L":
            accept.append("əl")
        if b == "L" and prev_b == "AH" and stress[i - 1] == 0:
            accept.append("əl")
        slots.append(Slot(b, s, DISPLAY.get(key, DISPLAY[b]), sorted(set(accept)), optional))
    return slots


def word_ipa(slots: list[Slot]) -> str:
    """IPA with a primary-stress mark (only for multi-syllable words)."""
    parts = [s.ipa for s in slots]
    vowels = [i for i, s in enumerate(slots) if s.stress is not None]
    primary = next((i for i in vowels if slots[i].stress == 1), None)
    if primary is not None and len(vowels) > 1:
        j = primary
        while j > 0 and slots[j - 1].stress is None:
            onset = tuple(s.arpa for s in slots[j - 1:primary])
            if len(onset) > 1 and onset not in ONSETS:
                break
            j -= 1
        parts.insert(j, "ˈ")
    return "".join(parts)


WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")


def analyze(text: str) -> list[WordPron]:
    d = _dict()
    out: list[WordPron] = []
    for m in WORD_RE.finditer(text):
        raw = m.group(0)
        key = raw.lower().replace("’", "'")
        variants = d.get(key)
        if not variants:
            fb = _fallback(key)
            variants = [fb] if fb else []
        wp = WordPron(raw, m.start(), m.end())
        seen = set()
        for v in variants[:4]:
            t = tuple(v)
            if t not in seen:
                seen.add(t)
                wp.prons.append(arpa_to_slots(v))
        out.append(wp)
    return out

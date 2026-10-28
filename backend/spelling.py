"""Align a word's letters to its ARPAbet phonemes (for per-letter colouring).

Dynamic programming over (letters, phones). Each phone consumes a 1-4 letter
grapheme; known English spellings are cheap, unknown ones costly. Letters may be
silent (attached to a neighbouring phone) and a phone may consume no letter.
"""
from __future__ import annotations

from functools import lru_cache

VOWEL_PHONES = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
VOWEL_LETTERS = set("aeiouy")

GRAPHEMES: dict[str, list[str]] = {
    "AA": ["a", "o", "ah", "al", "au", "aw", "ough", "ow", "ea"],
    "AE": ["a", "ai", "au", "al"],
    "AH": ["u", "o", "a", "e", "i", "ou", "oo", "oe", "io", "y", "ai", "ia", "eo"],
    "AO": ["o", "au", "aw", "a", "al", "ough", "augh", "ou", "oa", "oo"],
    "AW": ["ou", "ow", "ough", "au"],
    "AY": ["i", "y", "ie", "igh", "ei", "ai", "uy", "eye", "ye", "ey", "is", "ui"],
    "EH": ["e", "ea", "a", "ai", "ie", "ay", "ue", "ei", "eo"],
    "ER": ["er", "ir", "ur", "or", "ear", "our", "ar", "yr", "r", "re", "err", "urr", "ere"],
    "EY": ["a", "ai", "ay", "ei", "ey", "ea", "eigh", "aigh", "e", "et"],
    "IH": ["i", "y", "e", "ui", "ee", "ie", "a", "o", "u", "ea"],
    "IY": ["e", "ee", "ea", "ie", "ei", "y", "i", "ey", "eo", "ae", "oe", "ay", "is"],
    "OW": ["o", "oa", "ow", "oe", "ough", "ou", "eau", "ew", "au"],
    "OY": ["oi", "oy"],
    "UH": ["oo", "u", "ou", "o"],
    "UW": ["oo", "u", "ew", "ue", "o", "ou", "ui", "oe", "ough", "eu", "wo"],
    "B": ["b", "bb"], "CH": ["ch", "tch", "t", "c", "cz"], "D": ["d", "dd", "ed", "ld"],
    "DH": ["th"], "F": ["f", "ff", "ph", "gh"], "G": ["g", "gg", "gh", "gu", "gue"],
    "HH": ["h", "wh"], "JH": ["j", "g", "dg", "dge", "ge", "gi", "d", "gg"],
    "K": ["k", "c", "ck", "ch", "q", "cc", "que", "kh", "lk"], "L": ["l", "ll"],
    "M": ["m", "mm", "mb", "mn", "lm"], "N": ["n", "nn", "kn", "gn", "pn"], "NG": ["ng", "n"],
    "P": ["p", "pp"], "R": ["r", "rr", "wr", "rh"],
    "S": ["s", "ss", "c", "sc", "ce", "se", "ps", "st"],
    "SH": ["sh", "ti", "ci", "s", "ss", "ch", "si", "ssi", "sci", "ce"],
    "T": ["t", "tt", "ed", "th", "pt", "bt"], "TH": ["th"], "V": ["v", "f", "ve"],
    "W": ["w", "wh", "u", "o"], "Y": ["y", "i", "j"], "Z": ["z", "s", "zz", "ss", "x", "se", "ze"],
    "ZH": ["s", "si", "g", "z", "ge"],
}

# graphemes spelling two phones at once
DOUBLE: dict[str, list[tuple[str, str]]] = {
    "x": [("K", "S"), ("G", "Z"), ("K", "SH")],
    "qu": [("K", "W")],
    "u": [("Y", "UW"), ("Y", "AH"), ("Y", "UH"), ("Y", "ER")],
    "ue": [("Y", "UW")], "ew": [("Y", "UW")], "eu": [("Y", "UW")],
    "le": [("AH", "L")], "o": [("W", "AH")], "ure": [("Y", "ER")],
}

SILENT_CHEAP = {"e": 0.6, "h": 1.0, "'": 0.0, "’": 0.0, "k": 1.2, "w": 1.2, "b": 1.2, "g": 1.2, "u": 1.2, "t": 1.4, "l": 1.4}
COST_ZERO_PHONE = 2.5


def _phone_cost(chunk: str, phone: str) -> float:
    if chunk in GRAPHEMES.get(phone, ()):
        return 0.0
    if len(chunk) == 1:
        letter_vowel = chunk in VOWEL_LETTERS
        return 2.0 if letter_vowel == (phone in VOWEL_PHONES) else 3.5
    return 99.0


@lru_cache(maxsize=4096)
def align(word: str, phones: tuple[str, ...]) -> list[list[int]]:
    """For each letter of `word`, the indices of the phones it spells."""
    w = word.lower()
    n, m = len(w), len(phones)
    INF = float("inf")
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[tuple | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            cur = dp[i][j]
            if cur == INF:
                continue

            def relax(ni, nj, c, op):
                if cur + c < dp[ni][nj]:
                    dp[ni][nj] = cur + c
                    back[ni][nj] = (i, j, op)

            if j < m:
                for k in range(1, 5):
                    if i + k <= n:
                        c = _phone_cost(w[i:i + k], phones[j])
                        if c < 99:
                            relax(i + k, j + 1, c, "map")
                relax(i, j + 1, COST_ZERO_PHONE, "zero")
            if j + 1 < m:
                for k in range(1, 4):
                    pair = (phones[j], phones[j + 1])
                    if i + k <= n and pair in DOUBLE.get(w[i:i + k], ()):
                        relax(i + k, j + 2, 0.2, "double")
            if i < n:
                relax(i + 1, j, SILENT_CHEAP.get(w[i], 1.8), "silent")

    owners: list[list[int]] = [[] for _ in range(n)]
    zero_phones: list[int] = []
    silent: list[int] = []
    i, j = n, m
    while (i, j) != (0, 0):
        pi, pj, op = back[i][j]
        if op == "map":
            for li in range(pi, i):
                owners[li].append(pj)
        elif op == "double":
            for li in range(pi, i):
                owners[li] += [pj, pj + 1]
        elif op == "zero":
            zero_phones.append(pj)
        else:
            silent.append(pi)
        i, j = pi, pj

    # silent letters take the colour of the previous letter (or next, at word start)
    for li in sorted(silent):
        src = next((owners[k] for k in range(li - 1, -1, -1) if owners[k]), None) \
            or next((owners[k] for k in range(li + 1, n) if owners[k]), [])
        owners[li] = list(src)
    # phones without letters mark the letters next to them
    for pj in zero_phones:
        cand = [li for li in range(n) if any(o == pj - 1 for o in owners[li])] or \
               [li for li in range(n) if any(o == pj + 1 for o in owners[li])]
        for li in cand:
            owners[li].append(pj)
    return [sorted(set(o)) for o in owners]

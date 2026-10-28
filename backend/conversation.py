"""Conversation engine: IELTS examiner (exam director + LLM), free-chat partner, per-turn
feedback and end-of-session report. Stateless: the client sends the history every turn."""
from __future__ import annotations

import json
import os
import random

import openrouter as orr
import question_bank as qb

# ------------------------------------------------------------------ topic banks
P1_OPENERS = ["Work or studies", "Hometown", "Home and accommodation"]
EXAMINER_NAMES = ["Daniel", "Sarah", "James", "Emily", "Michael", "Laura", "David", "Rachel"]

P1_ANSWERS = int(os.environ.get("IELTS_P1_ANSWERS", 7))  # name + ~6 questions over two topics
P3_ANSWERS = int(os.environ.get("IELTS_P3_ANSWERS", 5))


def new_exam_config(card_id: str | None = None, p1_topic: str | None = None) -> dict:
    """Random exam from the question bank; a specific cue card / Part 1 topic can be requested."""
    opener = random.choice(P1_OPENERS)
    others = [t for t in qb.PART1 if t not in P1_OPENERS]
    topic = p1_topic if p1_topic in qb.PART1 and p1_topic != opener else random.choice(others)
    card = qb.part2(card_id) or random.choice(qb.PART2)
    return {"examiner": random.choice(EXAMINER_NAMES), "p1_topics": [opener, topic],
            "p1_questions": {opener: qb.PART1[opener], topic: qb.PART1[topic]},
            "cue_card": {"id": card["id"], "topic": card["topic"], "points": card["points"],
                         "closing": card["closing"], "part3": card["part3"]}}


# ------------------------------------------------------------------ prompts
EXAMINER_SYSTEM = """You are {examiner}, a certified, experienced IELTS Speaking examiner conducting an official face-to-face IELTS Speaking test. Behave exactly like a real examiner:
- Speak naturally, politely and neutrally, in clear British English. Be warm but professional.
- Ask ONE question at a time. Keep each turn short (usually 1-2 sentences). Use the official IELTS phrasing style.
- NEVER give feedback, corrections, praise of language, scores or hints during the test. Never explain grammar. Never answer for the candidate.
- You may add a very brief neutral acknowledgement before the next question ("Thank you.", "OK.", "Right.", "I see."). Never evaluate or praise the content ("That's interesting", "Great", "That sounds like...") - real examiners stay neutral.
- Never repeat or paraphrase a question you have already asked in this test; each question must cover a new angle.
- Part 1: short questions about familiar topics. Part 3: more abstract, analytical discussion questions linked to the Part 2 topic (compare, evaluate, predict, give reasons); ask follow-ups that build on what the candidate actually said ("Why do you think that is?", "Do you think that will change in the future?").
- If the candidate's answer is very short, you may ask a short follow-up ("Why?", "Can you tell me more about that?") instead of moving on, but still follow the stage instruction.
- If the candidate asks you to repeat, repeat or rephrase the question. If they go off-topic or say something unclear, gently steer back.
- The candidate's words come from speech recognition, so ignore small transcription glitches.
- Plain spoken text only: no markdown, no emojis, no stage directions, no lists.

Output ONLY the exact words you say now, nothing else (no quotes, no speaker label, no JSON)."""

CHAT_SYSTEM = """You are {name}, a friendly, curious native English speaker chatting with a Vietnamese learner who wants to improve their spoken English. {scenario}
Learner level: {level}. Topic preference: {topic}.
How to talk:
- Sound like a real person in a relaxed spoken conversation: always use contractions (I'm, it's, don't, you'd), natural reactions ("Oh nice!", "Really? How come?"), occasional short personal opinions or experiences.
- Keep every reply SHORT: 1-3 sentences, then end with ONE open question that invites the learner to talk more. Never ask several questions at once.
- Match the learner's level: {level_hint}
- Build on what they actually said; remember earlier details in the conversation.
- If they make a mistake, do NOT lecture. At most, naturally recast the correct form in your reply (e.g. they say "I go there yesterday" -> "Oh, you went there yesterday? ...").
- If they write or say something in Vietnamese or seem stuck, help briefly in simple English and keep the conversation going.
- The learner's words come from speech recognition, so ignore small transcription glitches.
- Plain spoken text only: no markdown, no emojis, no lists.

Output ONLY the exact words you say now, nothing else (no quotes, no speaker label, no JSON)."""

LEVEL_HINTS = {
    "A2": "use very simple, common words and short sentences; speak slowly and clearly.",
    "B1": "use everyday vocabulary and clear sentences; avoid idioms or explain them.",
    "B2": "use natural vocabulary with some common idioms and phrasal verbs.",
    "C1": "speak fully naturally with idioms, nuance and more complex ideas.",
}

COACH_SYSTEM = """You are {name}, an experienced, warm and energetic IELTS Speaking teacher giving a live one-to-one speaking lesson to a Vietnamese learner. Learner's current level: {level}. Target: IELTS band {target}. Lesson focus: {focus}. Topic: {topic}.

Your teaching loop - follow it every turn:
1. ASK one IELTS-style question that fits the focus. Part 1: a short personal question. Part 2: a cue-card topic - say the topic and its 3-4 prompts naturally, then "Take a moment to think, then talk for about a minute." Part 3: an abstract discussion question (opinions, comparisons, causes, future).
2. When the learner ANSWERS a question, react like a great teacher in 3-5 short spoken sentences:
   - one genuine, specific piece of praise (what actually worked);
   - the single most important fix: quote the learner's phrase and give the better version ("Instead of 'it have many opportunity', say 'it offers lots of opportunities'.");
   - one upgrade towards band {target}: a higher-level word, collocation, idiom or discourse marker they could use here, OR - if the answer was short or undeveloped - a thinking strategy (Answer -> Reason -> Example, contrast with the past, a quick personal story, paraphrasing the question);
   - then ask them to TRY AGAIN: answer the same question once more using the fix or upgrade.
3. When the learner gives a RETRY: say specifically what improved, add at most one tiny extra tip, then ask a NEW question (a natural follow-up or a new angle). If the retry still has the same main problem, model a short example answer (1-2 sentences) and ask them to say it once more. Never more than two retries on the same question.
4. Every few questions, briefly teach one reusable speaking skill based on what you've noticed: fluency (linking words, natural fillers like "Well, let me think...", extending answers), vocabulary (topic collocations, paraphrasing the question), coherence (structuring ideas), or confidence.
Style:
- Sound like a real, encouraging teacher in a live lesson: concrete and specific, never vague ("Good job" alone is not enough). Use contractions.
- Keep each turn under about 70 words so it sounds natural when spoken. Ask only one question at a time.
- {lang_rule}
- The learner's words come from speech recognition: ignore punctuation and obvious transcription glitches, and don't "correct" what may only be a recognition error. If a pronunciation check is provided, you may point out one mispronounced word briefly and model it.
- Plain spoken text only: no markdown, lists, emojis, symbols like "->" or speaker labels.

Output ONLY the exact words you say now."""

COACH_FOCUS = {
    "part1": "IELTS Part 1 (short answers about familiar topics: extend each answer to 2-4 sentences)",
    "part2": "IELTS Part 2 (long turn: planning, structure and speaking for 1-2 minutes)",
    "part3": "IELTS Part 3 (discussion: developing and justifying opinions)",
    "mixed": "all three IELTS Speaking parts (start with Part 1, then move to Part 2 and Part 3 style questions)",
}
COACH_LANG = {
    "vi": ("IMPORTANT - speak VIETNAMESE for all your own talk (greeting, praise, explanations, tips, instructions), like a "
           "Vietnamese IELTS teacher; use English ONLY for the IELTS question itself and for the English words, phrases and "
           "model sentences you teach. Call the learner \"em\" and yourself \"cô\". Example: "
           "\"Cô thích cách em đưa ra lý do rất rõ ràng! Thay vì nói 'I like play football', em hãy nói 'I enjoy playing football' nhé. "
           "Em thử trả lời lại câu này, bắt đầu bằng 'Well, to be honest...' xem sao.\""),
    "en": "Speak clear, simple English throughout, adapted to the learner's level.",
}

FEEDBACK_SYSTEM = """You are an expert IELTS Speaking coach and English teacher for Vietnamese learners. You analyse ONE spoken answer of the learner and give precise, encouraging, actionable feedback.
Rules:
- The answer is an automatic speech-recognition transcript: ignore punctuation, capitalisation and obvious transcription glitches. Do not invent errors. If the answer is already correct and natural, say so and return few or no corrections.
- Focus on what matters for speaking: grammar (tenses, articles, agreement, prepositions, word order), word choice & collocations, word forms, naturalness/idiomatic expression, and (for IELTS) coherence, development of ideas and relevance to the question.
- "original" must be an exact substring copied from the learner's answer. "fixed" is the corrected phrase. Keep each correction minimal and specific. Max 5 corrections, most important first.
- "improved": rewrite the whole answer as a natural, fluent band 7.5-8 spoken answer that keeps the learner's ideas (for chat mode: how a native speaker would naturally say it). Spoken style, not essay style.
- "vocab": 2-3 useful words/phrases/collocations the learner could have used for this question, with Vietnamese meaning and a short example.
- "comment_vi": 1-3 short sentences IN VIETNAMESE: one concrete strength + the most important thing to improve (e.g. answer too short, needs a reason/example, repetition, off-topic). If pronunciation data is provided, mention the 1-2 most problematic words/sounds.
- All explanations in Vietnamese, concise and friendly. English examples stay in English.
Output JSON exactly:
{"corrections":[{"original":"...","fixed":"...","type":"grammar|vocabulary|collocation|word form|naturalness","explain_vi":"..."}],"improved":"...","vocab":[{"phrase":"...","meaning_vi":"...","example":"..."}],"comment_vi":"..."}"""

REPORT_SYSTEM = """You are a senior IELTS Speaking examiner and coach. Assess the whole session using the official IELTS Speaking band descriptors (public version):
- Fluency and Coherence: speaks at length without noticeable effort; hesitation, self-correction, discourse markers, logical development, relevance.
- Lexical Resource: range, precision, collocations, idiomatic language, paraphrase.
- Grammatical Range and Accuracy: range of structures (complex sentences, conditionals, passives, relative clauses) and frequency of errors.
- Pronunciation: provided by an automatic phoneme-level pronunciation assessor (you cannot hear the audio). Use the given "pronunciation_band_estimate" as the main evidence; adjust by at most 0.5 using the phoneme statistics, and explain using the weakest sounds/words.
Important:
- The transcripts come from speech recognition, which tends to hide hesitations and small errors, so do not over-reward fluency: also use the measured speaking rate, pauses and answer lengths. Very short answers (few words) indicate limited fluency and lexical resource.
- Be honest and calibrated like a real examiner (most learners are band 5-7). Bands are in 0.5 steps; overall = average of the four criteria rounded to the nearest 0.5 (x.25 -> round up to x.5, x.75 -> up to next whole).
- Write all comments IN VIETNAMESE, specific and actionable, quoting the learner's real words as evidence. English examples stay in English.
Output JSON exactly:
{"overall":6.5,"criteria":{"fluency":{"band":6.5,"comment_vi":"..."},"lexical":{"band":6.5,"comment_vi":"..."},"grammar":{"band":6.0,"comment_vi":"..."},"pronunciation":{"band":6.5,"comment_vi":"..."}},"cefr":"B2","summary_vi":"...","strengths_vi":["..."],"weaknesses_vi":["..."],"action_plan_vi":["..."],"key_corrections":[{"original":"...","fixed":"...","explain_vi":"..."}],"sample_answer":{"question":"...","answer":"..."}}
"sample_answer": pick the question the learner answered worst and give a model band-8 spoken answer."""


MODE_LABEL = {"ielts": "IELTS speaking test", "coach": "one-to-one IELTS speaking lesson with a teacher (includes retries of the same question)",
              "chat": "casual conversation practice"}


def coach_stage(history: list[dict], settings: dict) -> tuple[str, str]:
    """Lesson director for the teacher: every new question gets one guided retry.
    Returns (instruction, stage) where stage is "ask" (new question) or "retry"."""
    last = next((h for h in reversed(history) if h.get("role") == "assistant"), None)
    if last is None:
        return ("Start the lesson: greet the learner warmly in one short sentence, say in one sentence what you'll "
                "practise today, then ask the first question."), "ask"
    asked = sum(1 for h in history if h.get("role") == "assistant" and h.get("stage") == "ask")
    long_turn = settings.get("focus") == "part2"
    if last.get("stage") == "ask":
        retry = ("ask them to retell only the part that needs improving (a better opening, or one more developed point) in 2-3 sentences"
                 if long_turn else "ask them to answer the same question again using the fix or upgrade")
        return ("The learner just answered your question (first attempt). Give specific praise, the single most important "
                f"fix (quote their words and give the better version), one upgrade towards the target band, then {retry}. "
                "Do NOT ask a new question yet."), "retry"
    skill = (" Before the new question, briefly teach one reusable speaking skill based on what you have noticed so far."
             if asked and asked % 3 == 0 else "")
    return ("The learner just tried again. Say specifically what improved compared with their first attempt (or, if it "
            "did not improve, give a 1-2 sentence model answer for them to remember)." + skill +
            " Then ask a NEW question (a natural follow-up or a new angle on the topic)."), "ask"


def pron_note(pron: dict | None) -> str | None:
    """Short pronunciation summary of the learner's last answer, for the teacher's next turn."""
    if not pron:
        return None
    weak = [f'"{w["text"]}" ({round(w["score"])}%)' for w in pron.get("words", [])
            if not w.get("oov") and w.get("score") is not None and w["score"] < 60][:3]
    tail = f"; weakest words: {', '.join(weak)}" if weak else "; no clearly mispronounced words"
    return f"[Pronunciation check of the learner's last answer (automatic): overall {round(pron.get('overall', 0))}%{tail}]"


# ------------------------------------------------------------------ helpers
def _msgs(history: list[dict]) -> list[dict]:
    out = []
    for h in history:
        role = "assistant" if h.get("role") == "assistant" else "user"
        text = (h.get("text") or "").strip()
        if text:
            out.append({"role": role, "content": text})
    return out


def _count_answers(history: list[dict], part: int) -> int:
    """Learner answers given after an examiner turn of this part."""
    n, cur = 0, 0
    for h in history:
        if h.get("role") == "assistant":
            cur = h.get("part", cur)
        elif cur == part and (h.get("text") or "").strip():
            n += 1
    return n


def _current_part(history: list[dict]) -> int:
    for h in reversed(history):
        if h.get("role") == "assistant" and h.get("part"):
            return int(h["part"])
    return 0


def exam_stage(history: list[dict], cfg: dict) -> tuple[str, int, bool, dict | None]:
    """Decide what the examiner must do next: (instruction, part, end, cue_card)."""
    part = _current_part(history)
    t1, t2 = cfg["p1_topics"]
    card = cfg["cue_card"]
    bank = cfg.get("p1_questions", {})

    def ideas(topic: str) -> str:
        qs = bank.get(topic)
        return (f" Typical questions for this topic (use or adapt one you haven't asked yet): {' | '.join(qs)}." if qs else "")
    p3 = card.get("part3") or []
    p3_ideas = (f" Typical Part 3 questions for this topic (use or adapt one you haven't asked yet, and build on the "
                f"candidate's previous answer): {' | '.join(p3)}." if p3 else "")
    card_text = f'{card["topic"]}. You should say: ' + "; ".join(card["points"]) + "; " + card["closing"]
    if part == 0:
        return (f"Start the test. Greet the candidate (it is a normal day), introduce yourself as {cfg['examiner']}, "
                "and ask the candidate for their full name. Nothing else.", 1, False, None)
    if part == 1:
        n = _count_answers(history, 1)
        if n == 1:
            return (f"Thank them, say that in this first part you'd like to ask some questions about themselves, "
                    f"then ask the first Part 1 question on the topic: {t1}." + ideas(t1), 1, False, None)
        if n < min(4, P1_ANSWERS):
            return f"Ask the next short Part 1 question on the topic: {t1} (a different angle from previous questions)." + ideas(t1), 1, False, None
        if n == 4 and n < P1_ANSWERS:
            return f"Move to a new Part 1 topic: say \"Now let's talk about {t2.lower()}.\" and ask the first question about it." + ideas(t2), 1, False, None
        if n < P1_ANSWERS:
            return f"Ask the next short Part 1 question about {t2}." + ideas(t2), 1, False, None
        return ("Move to Part 2. Say naturally: \"Now I'm going to give you a topic and I'd like you to talk about it for one to two minutes. "
                "Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish. "
                f"Here's your topic.\" Then read the topic title: \"{card['topic']}\". Do not read the bullet points.", 2, False, card)
    if part == 2:
        n = _count_answers(history, 2)
        if n == 0:
            return ("The candidate has not spoken yet. Remind them briefly: \"Remember, you have one to two minutes for this. "
                    "Please start speaking now.\"", 2, False, card)
        if n == 1:
            return (f"The long turn is finished. Say \"Thank you.\" and ask ONE short rounding-off question related to what they said "
                    f"about the topic ({card_text}).", 2, False, None)
        return (f"Move to Part 3. Say: \"We've been talking about {card['topic'].lower().replace('describe ', '')}, and I'd like to discuss with you "
                "one or two more general questions related to this.\" Then ask the first abstract Part 3 discussion question linked to the topic." + p3_ideas,
                3, False, None)
    n = _count_answers(history, 3)
    if n < P3_ANSWERS:
        return ("Ask the next Part 3 discussion question: build on the candidate's last answer or move to a related broader issue "
                "(society, comparisons past/present, advantages/disadvantages, future trends). One question only." + p3_ideas, 3, False, None)
    return ("End the test now: say \"Thank you. That is the end of the speaking test.\" and a brief polite goodbye. No question.", 3, True, None)


# ------------------------------------------------------------------ public API
def _plan(mode: str, history: list[dict], settings: dict, note: str | None = None) -> tuple[list[dict], dict, float, int]:
    """Messages for the next assistant turn + its metadata (part / end / cue card)."""
    if mode == "ielts":
        cfg = settings.get("exam") or new_exam_config()
        instr, part, end, card = exam_stage(history, cfg)
        msgs = [{"role": "system", "content": EXAMINER_SYSTEM.format(examiner=cfg["examiner"])}] + _msgs(history)
        msgs.append({"role": "system", "content": f"[Stage instruction for your next turn - Part {part}] {instr}"})
        return msgs, {"part": part, "end": end, "cue_card": card}, 0.6, 300

    if mode == "coach":
        lang_rule = COACH_LANG.get(settings.get("lang", "en"), COACH_LANG["en"])
        system = COACH_SYSTEM.format(
            name=settings.get("partner", "Anna"), level=settings.get("level", "B1"),
            target=settings.get("target", "7.0"), focus=COACH_FOCUS.get(settings.get("focus", "mixed"), COACH_FOCUS["mixed"]),
            topic=settings.get("topic") or "choose varied, common IELTS topics", lang_rule=lang_rule)
        instr, stage = coach_stage(history, settings)
        msgs = [{"role": "system", "content": system}] + _msgs(history)
        if note:
            msgs.append({"role": "system", "content": note})
        msgs.append({"role": "system", "content": f"[What to do in this turn] {instr} Language: {lang_rule}"})
        return msgs, {"part": None, "end": False, "cue_card": None, "stage": stage}, 0.7, 350

    level = settings.get("level", "B1")
    scenario = settings.get("scenario") or ""
    if scenario:
        scenario = f"Role-play scenario (stay in role, play the other person): {scenario}."
    system = CHAT_SYSTEM.format(name=settings.get("partner", "Emma"), scenario=scenario, level=level,
                                topic=settings.get("topic") or "anything the learner enjoys",
                                level_hint=LEVEL_HINTS.get(level, LEVEL_HINTS["B1"]))
    msgs = [{"role": "system", "content": system}] + _msgs(history)
    if not history:
        msgs.append({"role": "system", "content": "Start the conversation: greet the learner warmly in one sentence and ask one easy opening question about the topic."})
    return msgs, {"part": None, "end": False, "cue_card": None}, 0.8, 250


def reply_stream(mode: str, history: list[dict], settings: dict, note: str | None = None):
    """Yields ("meta", {...}) first, then ("delta", text) chunks as the LLM writes them.
    `note` is extra per-turn context for the teacher (e.g. the pronunciation check)."""
    msgs, meta, temperature, max_tokens = _plan(mode, history, settings, note)
    yield "meta", meta
    lead = True
    for delta in orr.chat_stream(msgs, temperature=temperature, max_tokens=max_tokens):
        if lead:  # some models open with a quote or a speaker label; drop it
            delta = delta.lstrip().lstrip('"“').removeprefix("Examiner:").lstrip()
            if not delta:
                continue
            lead = False
        yield "delta", delta


def reply(mode: str, history: list[dict], settings: dict) -> dict:
    """Non-streaming convenience wrapper: {"reply", "part", "end", "cue_card"}."""
    meta, text = {}, ""
    for kind, val in reply_stream(mode, history, settings):
        if kind == "meta":
            meta = val
        else:
            text += val
    return {"reply": text.strip().rstrip('"”').strip(), **meta}


def feedback(mode: str, question: str, answer: str, pron: dict | None) -> dict:
    ctx = {"mode": MODE_LABEL.get(mode, "casual conversation"),
           "question_or_previous_turn": question, "learner_answer": answer}
    if pron:
        weak = [{"word": w["text"], "score": round(w["score"])} for w in pron.get("words", [])
                if not w.get("oov") and w.get("score") is not None and w["score"] < 70][:6]
        ctx["pronunciation"] = {"overall_phoneme_score": pron.get("overall"), "weak_words": weak,
                                "words_per_minute": pron.get("wpm")}
    data = orr.chat_json([{"role": "system", "content": FEEDBACK_SYSTEM},
                          {"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}],
                         temperature=0.3, max_tokens=900)
    # keep only corrections whose "original" really occurs in the answer
    low = answer.lower()
    data["corrections"] = [c for c in data.get("corrections", [])
                           if isinstance(c, dict) and c.get("original") and c["original"].lower() in low][:5]
    return data


def pron_band(avg_score: float | None) -> float | None:
    """Map the mean phoneme score (0-100, 'normal' strictness) to an IELTS pronunciation band."""
    if avg_score is None:
        return None
    for thr, band in [(95, 9.0), (92, 8.5), (88, 8.0), (84, 7.5), (79, 7.0), (73, 6.5), (66, 6.0), (58, 5.5), (50, 5.0), (40, 4.5)]:
        if avg_score >= thr:
            return band
    return 4.0


def report(mode: str, history: list[dict], pron_summary: dict) -> dict:
    turns = []
    q = ""
    for h in history:
        if h.get("role") == "assistant":
            q = h.get("text", "")
        elif (h.get("text") or "").strip():
            turns.append({"part": h.get("part"), "question": q, "answer": h["text"],
                          "words": len(h["text"].split())})
    ctx = {"mode": MODE_LABEL.get(mode, "casual conversation practice"),
           "turns": turns,
           "pronunciation_band_estimate": pron_band(pron_summary.get("avg_score")),
           "pronunciation_stats": pron_summary}
    return orr.chat_json([{"role": "system", "content": REPORT_SYSTEM},
                          {"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}],
                         model=orr.REPORT_MODEL, temperature=0.2, max_tokens=2500, timeout=90)

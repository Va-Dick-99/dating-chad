"""The core engine: turns a SuggestRequest into analysis + message suggestions.

Uses an LLM when an API key is configured, otherwise falls back to a lightweight
heuristic generator so the app is fully runnable out of the box.
"""

from __future__ import annotations

import json
import re

from app.analysis.prompts import SYSTEM_PROMPT, build_user_prompt
from app.config import get_settings
from app.models import (
    ConversationInsights,
    ProfileInsights,
    Sender,
    Suggestion,
    SuggestRequest,
    SuggestResponse,
)


def generate(req: SuggestRequest) -> SuggestResponse:
    settings = get_settings()
    if settings.llm_enabled:
        try:
            resp = _generate_llm(req)
        except Exception:  # pragma: no cover - network/parse failures fall back gracefully
            resp = _generate_heuristic(req)
            resp.conversation_insights.summary = (
                "(LLM call failed; showing heuristic fallback.) "
                + resp.conversation_insights.summary
            )
    else:
        resp = _generate_heuristic(req)
    # When reusing a cached photo description (images not re-sent), keep it stable
    # so the panel's «По фото» box isn't clobbered between presses and the next
    # press sends the same summary back.
    if req.photo_summary and not req.photos:
        resp.profile_insights.photo_analysis = req.photo_summary
    _normalize_messages(resp)
    return resp


def _normalize_messages(resp: SuggestResponse) -> None:
    for s in resp.suggestions:
        s.message = _fix_sentence_caps(s.message)


# After . ! ? the next sentence must start with a capital letter.
_SENTENCE_CAP = re.compile(r"([.!?])(\s*)([a-zа-яё])", re.UNICODE)


def _fix_sentence_caps(text: str) -> str:
    if not text:
        return text
    return _SENTENCE_CAP.sub(lambda m: m.group(1) + m.group(2) + m.group(3).upper(), text)


# --------------------------------------------------------------------------- LLM


def _generate_llm(req: SuggestRequest) -> SuggestResponse:
    from openai import OpenAI

    settings = get_settings()
    client_kwargs: dict = {"api_key": settings.openai_api_key}
    if settings.openai_base_url.strip():
        client_kwargs["base_url"] = settings.openai_base_url.strip()
    client = OpenAI(**client_kwargs)

    user_text = build_user_prompt(req)
    if req.photos:
        user_content: list[dict] = [{"type": "text", "text": user_text}]
        for url in req.photos[:4]:  # cap to control cost / payload size
            if url:
                user_content.append({"type": "image_url", "image_url": {"url": url}})
        user_message: dict = {"role": "user", "content": user_content}
    else:
        user_message = {"role": "user", "content": user_text}

    completion = client.chat.completions.create(
        model=settings.openai_model,
        # Lower temperature → the model follows the opener rules (one detail,
        # short, easy question) instead of over-embellishing into trait-piles.
        temperature=0.8,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            user_message,
        ],
    )
    raw = completion.choices[0].message.content or "{}"
    data = json.loads(raw)

    resp = SuggestResponse(
        profile_insights=ProfileInsights(**data.get("profile_insights", {})),
        conversation_insights=ConversationInsights(**data.get("conversation_insights", {})),
        suggestions=[Suggestion(**s) for s in data.get("suggestions", [])],
        engine="llm",
    )
    if not resp.suggestions:
        # Defensive: never return an empty result to the UI.
        return _generate_heuristic(req)
    return resp


# --------------------------------------------------------------------- heuristic

_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "you", "your", "are", "but", "not",
    "have", "from", "they", "what", "when", "love", "like", "into", "just", "really",
    "very", "much", "about", "also", "who", "her", "his", "she", "him", "out", "all",
}


def _keywords(text: str, limit: int = 6) -> list[str]:
    words = re.findall(r"[a-zA-Z]{3,}", (text or "").lower())
    seen: list[str] = []
    for w in words:
        if w in _STOPWORDS or w in seen:
            continue
        seen.append(w)
        if len(seen) >= limit:
            break
    return seen


def _generate_heuristic(req: SuggestRequest) -> SuggestResponse:
    profile = req.profile
    name = (profile.name if profile and profile.name else "").strip()
    bio = profile.bio if profile and profile.bio else ""

    interests = list(profile.interests) if profile and profile.interests else []
    if not interests:
        interests = _keywords(bio + " " + " ".join(profile.prompts if profile else []))

    hooks = interests[:3] or ["their photos", "their bio", "where the pic was taken"]

    profile_insights = ProfileInsights(
        vibe=_guess_vibe(bio),
        interests=interests,
        conversation_hooks=[f"Ask about {h}" for h in hooks],
        compatibility_notes="Heuristic mode: add an OpenAI key for richer compatibility analysis.",
    )

    last = req.conversation[-1] if req.conversation else None
    whose_turn = "you" if (last is None or last.sender == Sender.them) else "them"
    convo_insights = ConversationInsights(
        whose_turn=whose_turn,
        sentiment=_guess_sentiment(req.conversation),
        engagement="opening" if not req.conversation else f"{len(req.conversation)} messages exchanged",
        green_flags=_green_flags(req.conversation),
        red_flags=_red_flags(req.conversation),
        summary=(
            "Time to send an opener." if not req.conversation
            else f"Last message was from {last.sender.value}. It's {whose_turn}'s turn."
        ),
    )

    suggestions = _heuristic_suggestions(req, name, hooks, last)

    return SuggestResponse(
        profile_insights=profile_insights,
        conversation_insights=convo_insights,
        suggestions=suggestions,
        engine="heuristic",
    )


def _guess_vibe(bio: str) -> str:
    b = (bio or "").lower()
    if any(w in b for w in ("hike", "travel", "adventure", "mountain", "surf")):
        return "Adventurous / outdoorsy"
    if any(w in b for w in ("coffee", "book", "art", "museum", "cozy")):
        return "Laid-back / creative"
    if any(w in b for w in ("gym", "fitness", "run", "lift")):
        return "Active / health-focused"
    if any(w in b for w in ("dog", "cat", "pet")):
        return "Animal lover"
    return "Friendly and approachable" if bio else "Not enough info yet"


def _guess_sentiment(conversation: list) -> str:
    if not conversation:
        return "n/a"
    text = " ".join(m.text.lower() for m in conversation)
    pos = sum(text.count(w) for w in ("haha", "lol", "love", "great", "yes", "😄", "😂", "❤", "!"))
    neg = sum(text.count(w) for w in ("no ", "busy", "later", "idk", "meh", "...", "whatever"))
    if pos > neg:
        return "positive / playful"
    if neg > pos:
        return "lukewarm — re-engage carefully"
    return "neutral"


def _green_flags(conversation: list) -> list[str]:
    flags: list[str] = []
    for m in conversation:
        if m.sender == Sender.them:
            t = m.text.lower()
            if "?" in m.text:
                flags.append("They ask you questions (mutual interest)")
            if any(w in t for w in ("haha", "lol", "😂", "😄")):
                flags.append("They're laughing / light-hearted")
    return sorted(set(flags))


def _red_flags(conversation: list) -> list[str]:
    flags: list[str] = []
    them = [m for m in conversation if m.sender == Sender.them]
    if them and all(len(m.text) < 6 for m in them):
        flags.append("Very short replies — low effort, keep it breezy")
    return flags


def _heuristic_suggestions(req: SuggestRequest, name: str, hooks: list[str], last) -> list[Suggestion]:
    greeting = f"Hey {name}" if name else "Hey"
    hook = hooks[0] if hooks else "your profile"
    out: list[Suggestion] = []

    if req.goal == "open" or not req.conversation:
        templates = {
            "playful": (
                f"{greeting} — okay, real talk: I need a ruling on {hook}. "
                "Underrated, overrated, or dangerously underrated?",
                "Light, opinion-based opener that's easy and fun to answer.",
            ),
            "sincere": (
                f"{greeting}! {hook.capitalize()} genuinely caught my eye on your profile — "
                "what got you into it?",
                "Warm and specific; shows you actually read the profile.",
            ),
            "witty": (
                f"{greeting}, I'm legally obligated to ask the important question first: "
                f"{hook} or absolute chaos?",
                "Playful framing that invites a personality-revealing answer.",
            ),
        }
    else:
        last_text = last.text if last else ""
        templates = {
            "playful": (
                f"Haha okay you've got my attention. So tell me more about {hook} 👀",
                "Keeps momentum, mirrors a playful tone, asks a follow-up.",
            ),
            "sincere": (
                f"That's actually really cool. What's the story behind it?"
                if last_text else "What's something you're genuinely excited about lately?",
                "Invites them to share more; shows real curiosity.",
            ),
            "witty": (
                "I feel like this conversation needs a high-stakes question: "
                "ideal weekend — slow morning or full adventure?",
                "Fun either/or that reveals lifestyle compatibility.",
            ),
        }

    for tone in req.tone:
        msg, why = templates.get(tone, templates.get("sincere"))
        out.append(Suggestion(tone=tone, message=msg, rationale=why))
    return out

"""Pydantic schemas shared across the API and engine."""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Sender(str, Enum):
    me = "me"
    them = "them"


class Message(BaseModel):
    sender: Sender
    text: str
    timestamp: Optional[str] = None


class Profile(BaseModel):
    """A match's profile. All fields optional so partial info still works."""

    name: Optional[str] = None
    age: Optional[int] = None
    bio: Optional[str] = None
    work: Optional[str] = None
    education: Optional[str] = None
    goal: Optional[str] = None
    interests: list[str] = Field(default_factory=list)
    prompts: list[str] = Field(
        default_factory=list,
        description="Profile prompt answers, e.g. Hinge/Bumble/Badoo style Q→A.",
    )
    details: list[str] = Field(
        default_factory=list,
        description="Extra tags: languages, height, relationship status, etc.",
    )
    app: Optional[str] = Field(default=None, description="tinder, badoo, hinge, bumble, ...")

    model_config = {"extra": "ignore"}


class SuggestRequest(BaseModel):
    """Everything the engine needs to craft message suggestions."""

    profile: Optional[Profile] = None
    conversation: list[Message] = Field(default_factory=list)
    goal: Literal["open", "continue"] = "continue"
    tone: list[str] = Field(
        default_factory=lambda: ["playful", "sincere", "witty"],
        description="Desired tones; one suggestion is generated per tone.",
    )
    about_me: Optional[str] = Field(
        default=None, description="Optional info about the user to personalize suggestions."
    )
    notes: Optional[str] = Field(default=None, description="Free-form extra context or constraints.")
    photos: list[str] = Field(
        default_factory=list,
        description="Profile photo data URLs (data:image/...;base64,...) or http URLs to analyze.",
    )
    photo_summary: Optional[str] = Field(
        default=None,
        description="Pre-extracted text description of her photos, reused on repeat calls "
        "instead of re-sending images, to avoid re-spending vision tokens.",
    )


class ProfileInsights(BaseModel):
    vibe: str = ""
    interests: list[str] = Field(default_factory=list)
    conversation_hooks: list[str] = Field(default_factory=list)
    compatibility_notes: str = ""
    photo_analysis: str = Field(
        default="",
        description="What is visible on profile photos: setting, activities, vibe (Russian).",
    )


class ConversationInsights(BaseModel):
    whose_turn: str = ""
    sentiment: str = ""
    engagement: str = ""
    green_flags: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    summary: str = ""


class Suggestion(BaseModel):
    tone: str
    message: str
    rationale: str


class SuggestResponse(BaseModel):
    profile_insights: ProfileInsights = Field(default_factory=ProfileInsights)
    conversation_insights: ConversationInsights = Field(default_factory=ConversationInsights)
    suggestions: list[Suggestion] = Field(default_factory=list)
    engine: Literal["llm", "heuristic"] = "heuristic"

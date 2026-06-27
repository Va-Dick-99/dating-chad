"""Connector abstraction."""

from __future__ import annotations

import abc

from pydantic import BaseModel, Field

from app.models import Message, Profile


class Match(BaseModel):
    """A match plus the conversation we've had with them."""

    match_id: str
    profile: Profile = Field(default_factory=Profile)
    conversation: list[Message] = Field(default_factory=list)


class BaseConnector(abc.ABC):
    """Source of matches/conversations. Implementations may be read-only."""

    name: str = "base"

    @abc.abstractmethod
    def list_matches(self) -> list[Match]:
        """Return matches with their profiles and conversation history."""

    def get_match(self, match_id: str) -> Match | None:
        for m in self.list_matches():
            if m.match_id == match_id:
                return m
        return None

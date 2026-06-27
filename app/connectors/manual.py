"""Manual / import connector.

This is the recommended, ToS-safe way to use dating-chad: you paste or import the
profile text and conversation yourself (e.g. copied from the app, or exported via
the app's official "download my data" feature).

It also parses a simple chat transcript format::

    them: hey, nice profile!
    me: thanks! your dog is adorable, what's their name?
    them: haha that's Biscuit
"""

from __future__ import annotations

import re

from app.connectors.base import BaseConnector, Match
from app.models import Message, Profile, Sender

_LINE_RE = re.compile(r"^\s*(me|them|you|match|i|they)\s*[:\-]\s*(.+)$", re.IGNORECASE)
_ME_ALIASES = {"me", "you", "i"}


class ManualConnector(BaseConnector):
    name = "manual"

    def list_matches(self) -> list[Match]:
        # Manual connector is stateless; callers parse on demand.
        return []

    @staticmethod
    def parse_transcript(text: str) -> list[Message]:
        """Parse a `sender: text` transcript into structured messages.

        Lines without a recognized `sender:` prefix are appended to the previous
        message (multi-line support).
        """
        messages: list[Message] = []
        for raw in (text or "").splitlines():
            line = raw.rstrip()
            if not line.strip():
                continue
            m = _LINE_RE.match(line)
            if m:
                tag = m.group(1).lower()
                sender = Sender.me if tag in _ME_ALIASES else Sender.them
                messages.append(Message(sender=sender, text=m.group(2).strip()))
            elif messages:
                messages[-1].text += "\n" + line.strip()
        return messages

    @staticmethod
    def build_match(profile: Profile | None, transcript: str, match_id: str = "manual") -> Match:
        return Match(
            match_id=match_id,
            profile=profile or Profile(),
            conversation=ManualConnector.parse_transcript(transcript),
        )

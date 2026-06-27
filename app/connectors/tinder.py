"""Unofficial Tinder connector (OPT-IN, ToS-RISKY, MAY BREAK).

⚠️  Tinder/Badoo do NOT provide a public API for reading conversations. This
connector talks to Tinder's private mobile endpoints using an `X-Auth-Token`.
Using it may violate Tinder's Terms of Service and can get your account limited
or banned. It is provided purely as a structural example and is disabled unless
you explicitly set TINDER_X_AUTH_TOKEN.

For Badoo there is no comparable usable endpoint; use the manual connector or
Badoo's official "Download my data" export instead.
"""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.connectors.base import BaseConnector, Match
from app.models import Message, Profile, Sender

_API_BASE = "https://api.gotinder.com"


class TinderConnector(BaseConnector):
    name = "tinder"

    def __init__(self) -> None:
        self.token = get_settings().tinder_x_auth_token.strip()

    def _client(self) -> httpx.Client:
        if not self.token:
            raise RuntimeError(
                "Tinder connector disabled. Set TINDER_X_AUTH_TOKEN to enable it, and "
                "understand it is unofficial and may violate ToS."
            )
        return httpx.Client(
            base_url=_API_BASE,
            headers={"X-Auth-Token": self.token, "Content-Type": "application/json"},
            timeout=20.0,
        )

    def list_matches(self, limit: int = 30) -> list[Match]:
        with self._client() as client:
            resp = client.get("/v2/matches", params={"count": limit, "message": 1})
            resp.raise_for_status()
            data = resp.json().get("data", {}).get("matches", [])

        matches: list[Match] = []
        for raw in data:
            person = raw.get("person", {}) or {}
            profile = Profile(
                name=person.get("name"),
                bio=person.get("bio"),
                app="tinder",
            )
            convo = [
                Message(
                    sender=Sender.me if msg.get("from") == raw.get("_id") else Sender.them,
                    text=msg.get("message", ""),
                    timestamp=msg.get("sent_date"),
                )
                for msg in raw.get("messages", [])
            ]
            matches.append(Match(match_id=raw.get("_id", ""), profile=profile, conversation=convo))
        return matches

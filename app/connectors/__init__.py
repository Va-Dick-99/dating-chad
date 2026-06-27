"""Connectors import conversations/profiles from various sources.

`manual` works today (paste/JSON import). `tinder` is an opt-in, unofficial,
ToS-risky stub kept behind an explicit token. See README for the full caveats.
"""

from app.connectors.base import BaseConnector, Match
from app.connectors.manual import ManualConnector

__all__ = ["BaseConnector", "Match", "ManualConnector", "get_connector"]


def get_connector(name: str) -> BaseConnector:
    name = (name or "").lower()
    if name in ("manual", "import", "paste"):
        return ManualConnector()
    if name == "tinder":
        from app.connectors.tinder import TinderConnector

        return TinderConnector()
    raise ValueError(f"Unknown connector: {name!r}")

"""Quick offline smoke test of the engine + API (heuristic mode)."""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def main() -> None:
    h = client.get("/api/health").json()
    print("health:", h)

    payload = {
        "profile": {"name": "Alex", "bio": "climber, coffee snob, dog mom", "interests": ["climbing", "coffee"]},
        "transcript": "them: hey! love that you're into climbing\nme: haha guilty — indoor or real rock?\nthem: real rock, multi-pitch last month",
        "goal": "continue",
        "tone": ["playful", "sincere", "witty"],
    }
    r = client.post("/api/suggest-from-transcript", json=payload)
    r.raise_for_status()
    data = r.json()
    print("engine:", data["engine"])
    print("profile vibe:", data["profile_insights"]["vibe"])
    print("whose_turn:", data["conversation_insights"]["whose_turn"])
    print("# suggestions:", len(data["suggestions"]))
    for s in data["suggestions"]:
        print(f"  [{s['tone']}] {s['message']}")

    assert data["suggestions"], "expected at least one suggestion"
    assert len(data["suggestions"]) == 3
    print("\nOK ✅")


if __name__ == "__main__":
    main()

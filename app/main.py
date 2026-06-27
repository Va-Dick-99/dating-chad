"""FastAPI app: serves the web UI and the suggestion/analysis API."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.analysis.engine import generate
from app.config import get_settings
from app.connectors import get_connector
from app.connectors.manual import ManualConnector
from app.models import Profile, SuggestRequest, SuggestResponse

app = FastAPI(title="dating-chad", version="0.1.0")

# The browser extension and any local tooling call this API from another origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


class TranscriptRequest(BaseModel):
    transcript: str


class ImportSuggestRequest(BaseModel):
    """Convenience endpoint: paste a raw transcript instead of structured messages."""

    profile: Profile | None = None
    transcript: str = ""
    goal: str = "continue"
    tone: list[str] | None = None
    about_me: str | None = None
    notes: str | None = None


@app.get("/api/health")
def health() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "engine": "llm" if s.llm_enabled else "heuristic",
        "model": s.openai_model if s.llm_enabled else None,
        "tinder_connector": bool(s.tinder_x_auth_token.strip()),
    }


@app.post("/api/parse-transcript")
def parse_transcript(req: TranscriptRequest) -> dict:
    msgs = ManualConnector.parse_transcript(req.transcript)
    return {"conversation": [m.model_dump() for m in msgs]}


@app.post("/api/suggest", response_model=SuggestResponse)
def suggest(req: SuggestRequest) -> SuggestResponse:
    return generate(req)


@app.post("/api/suggest-from-transcript", response_model=SuggestResponse)
def suggest_from_transcript(req: ImportSuggestRequest) -> SuggestResponse:
    conversation = ManualConnector.parse_transcript(req.transcript)
    suggest_req = SuggestRequest(
        profile=req.profile,
        conversation=conversation,
        goal=req.goal if req.goal in ("open", "continue") else "continue",
        tone=req.tone or ["playful", "sincere", "witty"],
        about_me=req.about_me,
        notes=req.notes,
    )
    return generate(suggest_req)


@app.get("/api/connectors/{name}/matches")
def connector_matches(name: str) -> dict:
    try:
        connector = get_connector(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    try:
        matches = connector.list_matches()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # pragma: no cover - upstream/network errors
        raise HTTPException(status_code=502, detail=f"Connector error: {e}") from e
    return {"matches": [m.model_dump() for m in matches]}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

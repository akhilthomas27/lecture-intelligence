# Load .env BEFORE any other imports.
#
# agents/ingestion_agent.py captures SUPADATA_API_KEY into a module-level
# constant on import, so load_dotenv() must already have populated os.environ
# by the time the agents package is imported below. Putting this anywhere
# else in the file silently breaks local dev (the constant becomes None even
# though the .env file is present).
from dotenv import load_dotenv

load_dotenv()

import asyncio  # noqa: E402
from typing import Any  # noqa: E402
from uuid import uuid4  # noqa: E402

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field, field_validator  # noqa: E402
from slowapi import Limiter, _rate_limit_exceeded_handler  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from slowapi.util import get_remote_address  # noqa: E402

import jobs  # noqa: E402
from agents.ingestion_agent import extract_video_id  # noqa: E402
from agents.search_agent import search as search_chunks  # noqa: E402
from agents.translation_agent import translate_materials  # noqa: E402
from orchestrator import lecture_graph  # noqa: E402

app = FastAPI(title="Lecture Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Rate limiting
#
# slowapi keys per remote address. The *expensive* endpoints (process,
# translate, search) get the 10/hour cap. The polling-friendly endpoints
# (status, results, health) are intentionally left unlimited so that a normal
# session — submit once, poll status every 2 s — doesn't get throttled.
#
# NOTE: behind a reverse proxy you'll want a key_func that reads
# X-Forwarded-For; get_remote_address only sees the proxy's IP.
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ProcessRequest(BaseModel):
    url: str = Field(..., description="A YouTube video URL")

    @field_validator("url")
    @classmethod
    def must_be_youtube_url(cls, v: str) -> str:
        try:
            extract_video_id(v)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        return v


class SearchRequest(BaseModel):
    job_id: str
    query: str = Field(..., min_length=1)


class TranslateRequest(BaseModel):
    job_id: str
    target_language: str = Field(
        ..., min_length=1, description="Target language name, e.g. 'Spanish' or 'French'"
    )


# ---------------------------------------------------------------------------
# Background pipeline runner
# ---------------------------------------------------------------------------


def _run_pipeline(job_id: str, url: str) -> None:
    initial: dict[str, Any] = {
        "url": url,
        "status": "pending",
        "embeddings_ready": False,
        "error": None,
    }
    final_state: dict[str, Any] = initial

    try:
        for state in lecture_graph.stream(initial, stream_mode="values"):
            final_state = state
            jobs.update(
                job_id,
                status=state.get("status"),
                error=state.get("error"),
                video_id=state.get("video_id"),
                embeddings_ready=state.get("embeddings_ready", False),
            )
    except Exception as exc:  # noqa: BLE001
        jobs.update(job_id, status="error", error=f"pipeline crashed: {exc}")
        return

    if final_state.get("status") == "complete":
        jobs.update(job_id, result=dict(final_state))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ping")
async def ping() -> dict[str, bool]:
    """Lightweight liveness endpoint for UptimeRobot keep-warm pings.

    Intentionally NOT rate-limited — UptimeRobot's free plan pings every
    5 minutes (12/hour), which would trip the 10/hour cap on /api/* routes.
    """
    return {"pong": True}


@app.post("/api/process")
@limiter.limit("10/hour")
async def process(
    request: Request,
    req: ProcessRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Kick off a pipeline run. Returns immediately with a job_id.

    Rate-limited to 10 requests per IP per hour — the heaviest endpoint.
    """
    job_id = str(uuid4())
    jobs.create(job_id, url=req.url)
    background_tasks.add_task(_run_pipeline, job_id, req.url)
    return {"job_id": job_id, "status": "pending"}


@app.get("/api/status/{job_id}")
async def get_status(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "video_id": job.get("video_id"),
        "embeddings_ready": job.get("embeddings_ready", False),
        "error": job.get("error"),
    }


@app.get("/api/results/{job_id}")
async def get_results(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    status = job["status"]
    if status == "error":
        raise HTTPException(
            status_code=500,
            detail={"job_id": job_id, "status": "error", "error": job.get("error")},
        )
    if status != "complete":
        raise HTTPException(
            status_code=409,
            detail={
                "job_id": job_id,
                "status": status,
                "message": "Job is not complete yet — poll /api/status/{job_id}.",
            },
        )

    return {"job_id": job_id, "status": status, "result": job["result"]}


@app.post("/api/search")
@limiter.limit("10/hour")
async def search_endpoint(request: Request, req: SearchRequest) -> dict[str, Any]:
    job = jobs.get(req.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.get("embeddings_ready"):
        raise HTTPException(
            status_code=409,
            detail=f"Embeddings not ready (job status={job.get('status')}).",
        )

    video_id = job.get("video_id")
    if not video_id:
        raise HTTPException(
            status_code=409, detail="Job has no video_id — cannot search."
        )

    try:
        hits = await asyncio.to_thread(search_chunks, video_id, req.query, 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"search failed: {exc}") from exc

    return {
        "job_id": req.job_id,
        "query": req.query,
        "result": hits[0] if hits else None,
    }


@app.post("/api/translate")
@limiter.limit("10/hour")
async def translate_endpoint(
    request: Request, req: TranslateRequest
) -> dict[str, Any]:
    """Translate the outline / summaries / flashcards into ``target_language``."""
    job = jobs.get(req.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "complete":
        raise HTTPException(
            status_code=409,
            detail=f"Job is not complete yet (status={job['status']}).",
        )

    result = job.get("result")
    if not result:
        raise HTTPException(status_code=409, detail="Job has no result payload.")

    try:
        translation = await asyncio.to_thread(
            translate_materials,
            result.get("outline", []),
            result.get("summaries", {}),
            result.get("flashcards", []),
            req.target_language,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"translation crashed: {exc}"
        ) from exc

    if not translation.get("success"):
        error_type = translation.get("error_type", "unknown")
        status_code = (
            400
            if error_type in {"no_language", "no_api_key"}
            else 502
            if error_type == "api_error"
            else 500
        )
        raise HTTPException(
            status_code=status_code,
            detail={
                "error_type": error_type,
                "error": translation.get("error"),
            },
        )

    return {
        "job_id": req.job_id,
        "target_language": req.target_language,
        "outline": translation["outline"],
        "summaries": translation["summaries"],
        "flashcards": translation["flashcards"],
    }

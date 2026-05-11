# Load .env BEFORE any other imports.
#
# agents/ingestion_agent.py captures PROXY_HOST / PROXY_PORT / PROXY_USER /
# PROXY_PASS into module-level constants on import, so load_dotenv() must
# already have populated os.environ by the time the agents package is
# imported below. Putting this anywhere else in the file silently breaks
# local dev (the constants become None even though the .env file is present).
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
from agents.search_agent import answer as answer_query  # noqa: E402
from agents.search_agent import search as search_chunks  # noqa: E402
from agents.translation_agent import translate_materials  # noqa: E402
from faculty_orchestrator import faculty_graph  # noqa: E402
from orchestrator import lecture_graph  # noqa: E402
from provost_orchestrator import provost_graph  # noqa: E402

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
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ProcessRequest(BaseModel):
    url: str = Field(..., description="A YouTube video URL")
    user_type: str | None = Field(
        default=None,
        description="Optional role hint. 'faculty' routes to the audit pipeline; "
        "any other value (or omitted) runs the standard student pipeline.",
    )

    @field_validator("url")
    @classmethod
    def must_be_youtube_url(cls, v: str) -> str:
        try:
            extract_video_id(v)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        return v


class ProcessCourseRequest(BaseModel):
    urls: list[str] = Field(..., min_length=1, max_length=13)
    objectives: str = Field(..., min_length=1)

    @field_validator("urls")
    @classmethod
    def all_urls_must_be_youtube(cls, v: list[str]) -> list[str]:
        for i, url in enumerate(v):
            try:
                extract_video_id(url)
            except ValueError as exc:
                raise ValueError(f"URL #{i + 1}: {exc}") from exc
        return v


class SearchRequest(BaseModel):
    job_id: str
    query: str = Field(..., min_length=1)


class AnswerRequest(BaseModel):
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
    """Standard student pipeline — ingest → curriculum → search."""
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


def _run_faculty_pipeline(job_id: str, url: str) -> None:
    """Faculty pipeline — ingest → audit. Stores the audit_report under
    ``result`` so /api/faculty-report can return it without copying."""
    initial: dict[str, Any] = {
        "url": url,
        "status": "pending",
        "error": None,
    }
    final_state: dict[str, Any] = initial

    try:
        for state in faculty_graph.stream(initial, stream_mode="values"):
            final_state = state
            jobs.update(
                job_id,
                status=state.get("status"),
                error=state.get("error"),
                video_id=state.get("video_id"),
            )
    except Exception as exc:  # noqa: BLE001
        jobs.update(job_id, status="error", error=f"faculty pipeline crashed: {exc}")
        return

    if final_state.get("status") == "complete":
        jobs.update(job_id, result=dict(final_state))


def _run_provost_pipeline(
    job_id: str, urls: list[str], objectives: str
) -> None:
    """Provost pipeline — multi-ingest → curriculum map."""
    initial: dict[str, Any] = {
        "urls": urls,
        "objectives": objectives,
        "status": "pending",
        "error": None,
    }
    final_state: dict[str, Any] = initial

    try:
        for state in provost_graph.stream(initial, stream_mode="values"):
            final_state = state
            jobs.update(
                job_id,
                status=state.get("status"),
                error=state.get("error"),
            )
    except Exception as exc:  # noqa: BLE001
        jobs.update(
            job_id, status="error", error=f"provost pipeline crashed: {exc}"
        )
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
    """Kick off a single-lecture pipeline run.

    If ``user_type == "faculty"`` the request is routed to the faculty audit
    pipeline (ingest → audit). Otherwise (student or unset) it runs the
    standard pipeline (ingest → curriculum → search index).

    Returns immediately with a ``job_id``; poll /api/status/{job_id} for
    progress.
    """
    job_id = str(uuid4())
    jobs.create(job_id, url=req.url)
    user_type = (req.user_type or "student").lower()
    jobs.update(job_id, user_type=user_type)

    if user_type == "faculty":
        background_tasks.add_task(_run_faculty_pipeline, job_id, req.url)
    else:
        background_tasks.add_task(_run_pipeline, job_id, req.url)

    return {"job_id": job_id, "status": "pending", "user_type": user_type}


@app.post("/api/process-course")
@limiter.limit("5/hour")
async def process_course(
    request: Request,
    req: ProcessCourseRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Kick off a provost course-coverage pipeline run.

    Heavier than /api/process — multiple lectures are ingested and then a
    single Gemini call analyses all of them against the supplied objectives.
    Rate-limited to 5/hour per IP.
    """
    job_id = str(uuid4())
    # We store the first URL as the "headline" url for display in /api/status,
    # plus the full URL list and objectives under separate keys.
    headline_url = req.urls[0]
    jobs.create(job_id, url=headline_url)
    jobs.update(
        job_id,
        user_type="provost",
        urls=list(req.urls),
        objectives=req.objectives,
    )

    background_tasks.add_task(
        _run_provost_pipeline, job_id, list(req.urls), req.objectives
    )
    return {"job_id": job_id, "status": "pending", "user_type": "provost"}


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

@app.get("/api/validate-playlist")
@limiter.limit("10/hour")
async def validate_playlist(request: Request, url: str) -> dict[str, Any]:
    """Fetch all video URLs from a YouTube playlist.
    
    Returns video list if playlist has 15 or fewer videos.
    Returns error if playlist has more than 15 videos.
    """
    from agents.provost.playlist_agent import fetch_playlist_videos
    
    if not url:
        raise HTTPException(status_code=400, detail="url parameter is required")
    
    result = await asyncio.to_thread(fetch_playlist_videos, url)
    
    if not result.get("success"):
        error_type = result.get("error_type", "unknown")
        status_code = (
            400 if error_type in {"invalid_url", "too_many_videos", "empty_playlist"}
            else 401 if error_type == "no_api_key"
            else 429 if error_type == "rate_limited"
            else 500
        )
        raise HTTPException(
            status_code=status_code,
            detail={
                "error_type": error_type,
                "error": result.get("error"),
                "video_count": result.get("video_count"),
            },
        )
    
    return {
        "success": True,
        "video_count": result["video_count"],
        "videos": result["videos"],
    }

@app.post("/api/search")
@limiter.limit("10/hour")
async def search_endpoint(request: Request, req: SearchRequest) -> dict[str, Any]:
    """Raw similarity search — returns ranked transcript chunks."""
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


@app.post("/api/answer")
@limiter.limit("10/hour")
async def answer_endpoint(request: Request, req: AnswerRequest) -> dict[str, Any]:
    """Study buddy answer — finds relevant lecture content and explains it.

    Unlike /api/search which returns raw transcript chunks, this endpoint
    uses Gemini to generate a plain-language explanation grounded in the
    lecture. If the topic is not covered in the lecture it says so clearly
    rather than returning a low-confidence chunk.
    """
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
            status_code=409, detail="Job has no video_id — cannot answer."
        )

    try:
        result = await asyncio.to_thread(answer_query, video_id, req.query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500, detail=f"answer generation failed: {exc}"
        ) from exc

    return {
        "job_id": req.job_id,
        "query": req.query,
        "answer": result["answer"],
        "covered": result["covered"],
        "source_timestamp": result.get("source_timestamp"),
        "source_text": result.get("source_text"),
        "similarity_score": result.get("similarity_score"),
    }


@app.get("/api/faculty-report/{job_id}")
async def get_faculty_report(job_id: str) -> dict[str, Any]:
    """Return the audit report for a completed faculty job."""
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
                "message": "Audit not complete yet — poll /api/status/{job_id}.",
            },
        )

    result = job.get("result") or {}
    audit_report = result.get("audit_report")
    if not audit_report:
        raise HTTPException(
            status_code=500,
            detail="Job completed but has no audit_report — wrong pipeline?",
        )

    return {
        "job_id": job_id,
        "video_id": result.get("video_id"),
        "url": job.get("url"),
        "audit_report": audit_report,
    }


@app.get("/api/provost-report/{job_id}")
async def get_provost_report(job_id: str) -> dict[str, Any]:
    """Return the curriculum coverage map for a completed provost job."""
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
                "message": "Coverage map not complete yet — poll /api/status/{job_id}.",
            },
        )

    result = job.get("result") or {}
    curriculum_map = result.get("curriculum_map")
    if not curriculum_map:
        raise HTTPException(
            status_code=500,
            detail="Job completed but has no curriculum_map — wrong pipeline?",
        )

    return {
        "job_id": job_id,
        "urls": result.get("urls") or job.get("urls") or [],
        "objectives": result.get("objectives") or job.get("objectives") or "",
        "failed_lectures": result.get("failed_lectures", []),
        "curriculum_map": curriculum_map,
    }


@app.post("/api/translate")
@limiter.limit("10/hour")
async def translate_endpoint(
    request: Request, req: TranslateRequest
) -> dict[str, Any]:
    """Translate the outline / summaries / flashcards into target_language."""
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
"""In-memory job store for pipeline runs.

Process-local: data is lost when uvicorn restarts. Fine for the prototype;
swap for Redis/SQLite once you need persistence or multiple workers.
"""
from __future__ import annotations

import time
from threading import Lock
from typing import Any, Optional

_store: dict[str, dict[str, Any]] = {}
_lock = Lock()


def create(job_id: str, *, url: str) -> dict[str, Any]:
    now = time.time()
    job: dict[str, Any] = {
        "job_id": job_id,
        "url": url,
        "status": "pending",
        "error": None,
        "video_id": None,
        "embeddings_ready": False,
        "result": None,
        "created_at": now,
        "updated_at": now,
    }
    with _lock:
        _store[job_id] = job
    return job


def get(job_id: str) -> Optional[dict[str, Any]]:
    with _lock:
        job = _store.get(job_id)
        return dict(job) if job is not None else None


def update(job_id: str, **changes: Any) -> None:
    """Patch a job in place. Unknown ids are ignored (treated as 'already gone')."""
    with _lock:
        if job_id not in _store:
            return
        _store[job_id].update(changes)
        _store[job_id]["updated_at"] = time.time()


def all_ids() -> list[str]:
    with _lock:
        return list(_store.keys())

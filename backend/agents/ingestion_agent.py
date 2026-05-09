"""Ingestion agent.

Fetches a YouTube transcript via ``youtube-transcript-api``, optionally
routed through an authenticated HTTP proxy, and chunks the result into
~500-token segments while preserving start/end times.

Why a proxy: most cloud hosts (Render, Fly, etc.) sit on IP ranges that
YouTube aggressively rate-limits or blocks. Setting ``PROXY_HOST/PORT/USER/PASS``
in the environment routes the request through a residential / data-center
proxy that YouTube will actually serve. For local dev, leave the proxy vars
unset and we'll call YouTube directly.

Public API
----------
    ingest_video(url) -> dict
        On success: {"success": True, "video_id": str, "chunks": [...]}
        On failure: {"success": False, "error_type": str, "error": str}

    extract_video_id(url) -> str
        Helper that parses any common YouTube URL form (or accepts a bare 11-char id).
        Raises ``ValueError`` on unrecognised input.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

from dotenv import load_dotenv
from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Startup: load .env (local dev) and capture proxy credentials once.
# ---------------------------------------------------------------------------

load_dotenv()

# Read proxy credentials at import time and cache them. Re-querying os.environ
# per request is pointless — env vars are fixed for the life of the process.
PROXY_HOST = os.getenv("PROXY_HOST")
PROXY_PORT = os.getenv("PROXY_PORT")
PROXY_USER = os.getenv("PROXY_USER")
PROXY_PASS = os.getenv("PROXY_PASS")

_PROXY_CONFIGURED = all([PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS])

if _PROXY_CONFIGURED:
    print(
        f"[ingestion_agent] Proxy: configured "
        f"({PROXY_USER}@{PROXY_HOST}:{PROXY_PORT})"
    )
else:
    missing = [
        name
        for name, val in (
            ("PROXY_HOST", PROXY_HOST),
            ("PROXY_PORT", PROXY_PORT),
            ("PROXY_USER", PROXY_USER),
            ("PROXY_PASS", PROXY_PASS),
        )
        if not val
    ]
    if missing == ["PROXY_HOST", "PROXY_PORT", "PROXY_USER", "PROXY_PASS"]:
        print(
            "[ingestion_agent] Proxy: NOT configured — calling YouTube directly. "
            "OK for local dev; set PROXY_HOST/PORT/USER/PASS in production."
        )
    else:
        print(
            "[ingestion_agent] Proxy: PARTIALLY configured — missing "
            f"{', '.join(missing)}. Falling back to direct calls."
        )


# Build the proxies dict once. ``None`` means "no proxy, call YouTube directly".
_PROXIES: dict[str, str] | None = (
    {
        "http": f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}",
        "https": f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}",
    }
    if _PROXY_CONFIGURED
    else None
)


# ---------------------------------------------------------------------------
# Chunking config
# ---------------------------------------------------------------------------

# English text averages ~1.33 tokens per whitespace-separated word for the
# OpenAI and Gemini tokenizers. The spec says "roughly 500 tokens".
_TOKENS_PER_WORD = 1.33
_TARGET_TOKENS = 500
_TARGET_WORDS = int(_TARGET_TOKENS / _TOKENS_PER_WORD)  # ≈ 376

# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------

_VIDEO_ID_RE = re.compile(
    r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([0-9A-Za-z_-]{11})"
)
_BARE_ID_RE = re.compile(r"^[0-9A-Za-z_-]{11}$")


def extract_video_id(url: str) -> str:
    """Pull the 11-char video id out of any YouTube URL form, or accept a bare id."""
    candidate = (url or "").strip()
    if not candidate:
        raise ValueError("URL is empty")
    if _BARE_ID_RE.match(candidate):
        return candidate
    match = _VIDEO_ID_RE.search(candidate)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract a YouTube video id from: {url!r}")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def ingest_video(url: str) -> dict[str, Any]:
    """Fetch a YouTube transcript and chunk it into ~500-token segments.

    Possible ``error_type`` values:
        - ``invalid_url``           the URL didn't contain a recognisable video id
        - ``video_unavailable``     private / removed / region-blocked / age-restricted
        - ``transcripts_disabled``  the owner disabled captions on this video
        - ``no_transcript``         no transcript exists for this video
        - ``ip_blocked``            YouTube blocked the (proxy or local) IP
        - ``proxy_error``           configured proxy could not be reached
        - ``fetch_failed``          any other unexpected failure
    """
    try:
        video_id = extract_video_id(url)
    except ValueError as exc:
        return {
            "success": False,
            "error_type": "invalid_url",
            "error": (
                f"That doesn't look like a valid YouTube URL. {exc}. "
                "Try a link like https://www.youtube.com/watch?v=VIDEO_ID."
            ),
        }

    try:
        # youtube-transcript-api 0.6.x: static method, accepts ``proxies`` dict
        # passed straight to ``requests``. Pass ``proxies=None`` and it just
        # behaves like a normal direct call.
        if _PROXIES:
            transcript = YouTubeTranscriptApi.get_transcript(
                video_id, proxies=_PROXIES
            )
        else:
            transcript = YouTubeTranscriptApi.get_transcript(video_id)
    except VideoUnavailable:
        return {
            "success": False,
            "error_type": "video_unavailable",
            "error": (
                f"YouTube says video {video_id} is unavailable. The video may "
                "be private, removed, region-blocked, or doesn't exist."
            ),
        }
    except TranscriptsDisabled:
        return {
            "success": False,
            "error_type": "transcripts_disabled",
            "error": (
                f"The owner of video {video_id} has disabled captions, so we "
                "can't fetch a transcript."
            ),
        }
    except NoTranscriptFound:
        return {
            "success": False,
            "error_type": "no_transcript",
            "error": (
                f"No transcript could be found for video {video_id} in any "
                "available language."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        return _classify_unexpected_error(video_id, exc)

    segments = [
        {
            "text": seg["text"],
            "start": float(seg["start"]),
            "duration": float(seg.get("duration", 0)),
        }
        for seg in transcript
        if seg.get("text", "").strip()
    ]

    chunks = _chunk_segments(segments)
    return {"success": True, "video_id": video_id, "chunks": chunks}


# ---------------------------------------------------------------------------
# Error classification (for everything ``youtube-transcript-api`` doesn't
# expose as a typed exception)
# ---------------------------------------------------------------------------


def _classify_unexpected_error(video_id: str, exc: Exception) -> dict[str, Any]:
    """Map an unexpected exception into our public error_type vocabulary.

    youtube-transcript-api raises ``IpBlocked`` / ``RequestBlocked`` /
    ``AgeRestricted`` etc. only in certain versions, so we route by class
    name rather than importing them eagerly. Proxy connection failures
    bubble up from ``requests`` as ``ProxyError`` / ``ConnectionError``.
    """
    name = type(exc).__name__
    msg = str(exc)
    msg_lower = msg.lower()

    if name in {"IpBlocked", "RequestBlocked", "YouTubeRequestFailed"}:
        return {
            "success": False,
            "error_type": "ip_blocked",
            "error": (
                "YouTube has blocked requests from "
                + ("the proxy IP" if _PROXIES else "this IP")
                + ". Rotate the proxy credentials or wait before retrying."
            ),
        }
    if name == "AgeRestricted":
        return {
            "success": False,
            "error_type": "video_unavailable",
            "error": (
                f"Video {video_id} is age-restricted. YouTube only serves the "
                "transcript to authenticated users for these."
            ),
        }
    if name in {"ProxyError", "ProxySchemeUnknown"} or (
        _PROXIES and ("proxy" in msg_lower or "tunnel" in msg_lower)
    ):
        return {
            "success": False,
            "error_type": "proxy_error",
            "error": (
                f"Could not reach the proxy at {PROXY_HOST}:{PROXY_PORT}. "
                "Check PROXY_HOST/PORT/USER/PASS env vars and that the proxy "
                f"endpoint is reachable. Detail: {exc}"
            ),
        }

    logger.warning("Unexpected ingestion error for %s: %s", video_id, exc)
    return {
        "success": False,
        "error_type": "fetch_failed",
        "error": f"Failed to fetch transcript for {video_id}: {exc}",
    }


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def _chunk_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate raw transcript segments into ~500-token chunks, keeping timestamps.

    A chunk's ``start_time`` is the start of its first included segment;
    ``end_time`` is the end (start + duration) of its last included segment.
    """
    chunks: list[dict[str, Any]] = []
    buf_words: list[str] = []
    buf_start: float | None = None
    buf_end: float = 0.0
    chunk_idx = 0

    for seg in segments:
        seg_text = seg["text"].strip()
        if not seg_text:
            continue

        seg_start = seg["start"]
        seg_end = seg_start + seg["duration"]

        if buf_start is None:
            buf_start = seg_start
        buf_words.extend(seg_text.split())
        buf_end = seg_end

        if len(buf_words) >= _TARGET_WORDS:
            chunks.append(_emit(chunk_idx, buf_words, buf_start, buf_end))
            chunk_idx += 1
            buf_words, buf_start = [], None

    if buf_words and buf_start is not None:
        chunks.append(_emit(chunk_idx, buf_words, buf_start, buf_end))

    return chunks


def _emit(idx: int, words: list[str], start: float, end: float) -> dict[str, Any]:
    return {
        "chunk_id": f"chunk-{idx}",
        "text": " ".join(words),
        "start_time": start,
        "end_time": end,
    }

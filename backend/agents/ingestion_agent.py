"""Ingestion agent.

Fetches a YouTube transcript via ``youtube-transcript-api`` (1.x), optionally
routed through an authenticated HTTP proxy, and chunks the result into
~500-token segments while preserving start/end times.

Why a proxy: most cloud hosts (Render, Fly, etc.) sit on IP ranges that
YouTube aggressively rate-limits or blocks. Setting ``PROXY_HOST/PORT/USER/PASS``
in the environment routes the request through a residential / data-center
proxy that YouTube will actually serve. For local dev, leave the proxy vars
unset and we'll call YouTube directly.

API note: this targets ``youtube-transcript-api >= 1.0``. The older 0.6.x
``get_transcript(video_id, proxies={...})`` static method is gone; the 1.x
flow is ``YouTubeTranscriptApi(proxy_config=...).fetch(video_id)``.

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
from youtube_transcript_api.proxies import GenericProxyConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Startup: load .env (local dev) and capture proxy credentials once.
# ---------------------------------------------------------------------------

load_dotenv()

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


# Build the API client once. With a proxy_config, every fetch routes through
# the proxy. Without one, fetches go direct.
def _build_api() -> YouTubeTranscriptApi:
    if not _PROXY_CONFIGURED:
        return YouTubeTranscriptApi()
    proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}"
    return YouTubeTranscriptApi(
        proxy_config=GenericProxyConfig(
            http_url=proxy_url,
            https_url=proxy_url,
        ),
    )


_api = _build_api()


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
        - ``video_unavailable``     private / removed / age-restricted / region-blocked
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
        # 1.x API: instance method returns a FetchedTranscript (iterable of
        # FetchedTranscriptSnippet, each with .text/.start/.duration attrs).
        fetched = _api.fetch(video_id)
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
            "text": snippet.text,
            "start": float(snippet.start),
            "duration": float(snippet.duration),
        }
        for snippet in fetched
        if snippet.text and snippet.text.strip()
    ]

    chunks = _chunk_segments(segments)
    return {"success": True, "video_id": video_id, "chunks": chunks}


# ---------------------------------------------------------------------------
# Error classification (for everything ``youtube-transcript-api`` doesn't
# expose as a typed exception we already catch above)
# ---------------------------------------------------------------------------


def _classify_unexpected_error(video_id: str, exc: Exception) -> dict[str, Any]:
    """Map an unexpected exception into our public error_type vocabulary.

    youtube-transcript-api raises ``IpBlocked`` / ``RequestBlocked`` /
    ``AgeRestricted`` / ``YouTubeRequestFailed`` etc. depending on version
    and condition; we route by class name so we don't depend on every
    exception being importable in every release.
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
                + ("the proxy IP" if _PROXY_CONFIGURED else "this IP")
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
        _PROXY_CONFIGURED and ("proxy" in msg_lower or "tunnel" in msg_lower)
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

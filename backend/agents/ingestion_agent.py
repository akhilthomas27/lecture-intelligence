"""Ingestion agent.

Fetches a YouTube transcript via the Supadata API
(https://api.supadata.ai/v1/youtube/transcript) with automatic
retry logic to handle transient failures.

For local development and production set SUPADATA_API_KEY in your
environment or .env file.

Public API
----------
    ingest_video(url) -> dict
        On success: {"success": True, "video_id": str, "chunks": [...]}
        On failure: {"success": False, "error_type": str, "error": str}

    extract_video_id(url) -> str
        Helper that parses any common YouTube URL form.
        Raises ValueError on unrecognised input.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

SUPADATA_API_KEY = os.getenv("SUPADATA_API_KEY")

if SUPADATA_API_KEY:
    print("[ingestion_agent] Supadata API key: found in environment ✓")
else:
    print(
        "[ingestion_agent] WARNING: SUPADATA_API_KEY is not set. "
        "Transcript fetching will fail. Set it in your .env file "
        "or Render environment variables."
    )

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TOKENS_PER_WORD = 1.33
_TARGET_TOKENS = 500
_TARGET_WORDS = int(_TARGET_TOKENS / _TOKENS_PER_WORD)  # ~376

_VIDEO_ID_RE = re.compile(
    r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([0-9A-Za-z_-]{11})"
)
_BARE_ID_RE = re.compile(r"^[0-9A-Za-z_-]{11}$")

_SUPADATA_ENDPOINT = "https://api.supadata.ai/v1/youtube/transcript"
_REQUEST_TIMEOUT = 30.0
_MAX_RETRIES = 3
_RETRY_DELAY = 2.0


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------


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
# Supadata client
# ---------------------------------------------------------------------------


def _fetch_from_supadata(video_id: str) -> dict[str, Any]:
    """Call Supadata API with retry logic.

    Returns raw Supadata response dict on success.
    Raises RuntimeError with error_type and message on failure.
    """
    api_key = SUPADATA_API_KEY
    if not api_key:
        raise RuntimeError("no_api_key|SUPADATA_API_KEY is not set in the environment.")

    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    last_error = None

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[ingestion_agent] Fetching transcript attempt {attempt}/{_MAX_RETRIES} for {video_id}")

            response = requests.get(
                _SUPADATA_ENDPOINT,
                params={"url": canonical_url, "text": "false"},
                headers={"x-api-key": api_key},
                timeout=_REQUEST_TIMEOUT,
            )

            # Handle HTTP errors
            if response.status_code in (401, 403):
                raise RuntimeError(
                    "no_api_key|Supadata API key is invalid or rejected. "
                    "Check your SUPADATA_API_KEY value."
                )
            if response.status_code == 429:
                raise RuntimeError(
                    "rate_limited|Supadata rate limit hit. "
                    "Try again in a minute or upgrade your plan."
                )
            if response.status_code == 404:
                raise RuntimeError(
                    "video_unavailable|Supadata says this video is unavailable. "
                    "It may be private, removed, or region-blocked."
                )

            response.raise_for_status()
            data = response.json()

            # Check for error in response body
            if isinstance(data, dict) and "error" in data and "content" not in data:
                error_msg = data.get("error", "Unknown error")
                raise RuntimeError(f"fetch_failed|Supadata error: {error_msg}")

            # Extract segments
            raw_segments = data.get("content") if isinstance(data, dict) else None
            if not isinstance(raw_segments, list) or not raw_segments:
                raise RuntimeError(
                    "no_transcript|Supadata returned no transcript segments. "
                    "The video may have no captions available."
                )

            # Parse segments
            segments = []
            for s in raw_segments:
                if not isinstance(s, dict):
                    continue
                text = (s.get("text") or "").strip()
                if not text:
                    continue
                try:
                    offset_ms = float(s.get("offset", 0))
                    duration_ms = float(s.get("duration", 0))
                except (TypeError, ValueError):
                    continue
                segments.append({
                    "text": text,
                    "start": offset_ms / 1000.0,
                    "duration": duration_ms / 1000.0,
                })

            if not segments:
                raise RuntimeError(
                    "no_transcript|Transcript came back empty after parsing."
                )

            print(f"[ingestion_agent] Successfully fetched {len(segments)} segments ✓")
            return segments

        except RuntimeError:
            # Don't retry on definitive errors like bad API key or missing transcript
            raise

        except requests.exceptions.Timeout as exc:
            last_error = f"Request timed out: {exc}"
            print(f"[ingestion_agent] Attempt {attempt} timed out. {'Retrying...' if attempt < _MAX_RETRIES else 'Giving up.'}")

        except requests.exceptions.ConnectionError as exc:
            last_error = f"Connection error: {exc}"
            print(f"[ingestion_agent] Attempt {attempt} connection error. {'Retrying...' if attempt < _MAX_RETRIES else 'Giving up.'}")

        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            print(f"[ingestion_agent] Attempt {attempt} failed: {exc}. {'Retrying...' if attempt < _MAX_RETRIES else 'Giving up.'}")

        if attempt < _MAX_RETRIES:
            time.sleep(_RETRY_DELAY)

    raise RuntimeError(f"fetch_failed|Failed after {_MAX_RETRIES} attempts. Last error: {last_error}")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def ingest_video(url: str) -> dict[str, Any]:
    """Fetch a YouTube transcript via Supadata and chunk it into ~500-token segments.

    Possible error_type values:
        - invalid_url
        - no_api_key
        - video_unavailable
        - transcripts_disabled
        - no_transcript
        - rate_limited
        - fetch_failed
    """
    # Validate URL locally first
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

    # Fetch from Supadata with retry
    try:
        segments = _fetch_from_supadata(video_id)
    except RuntimeError as exc:
        # Parse the error_type|message format
        parts = str(exc).split("|", 1)
        error_type = parts[0] if len(parts) == 2 else "fetch_failed"
        error_msg = parts[1] if len(parts) == 2 else str(exc)
        return {
            "success": False,
            "error_type": error_type,
            "error": error_msg,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "success": False,
            "error_type": "fetch_failed",
            "error": f"Unexpected error fetching transcript: {exc}",
        }

    # Chunk segments
    chunks = _chunk_segments(segments)
    return {
        "success": True,
        "video_id": video_id,
        "chunks": chunks,
    }


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def _chunk_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate raw transcript segments into ~500-token chunks."""
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
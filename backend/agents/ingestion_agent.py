"""Ingestion agent.

Fetches a YouTube transcript via the Supadata API
(https://api.supadata.ai/v1/youtube/transcript) and chunks it into
~500-token segments while preserving start/end times.

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

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# English text averages ~1.33 tokens per whitespace-separated word for both the
# OpenAI and Gemini tokenizers. The spec says "roughly 500 tokens".
_TOKENS_PER_WORD = 1.33
_TARGET_TOKENS = 500
_TARGET_WORDS = int(_TARGET_TOKENS / _TOKENS_PER_WORD)  # ≈ 376

# Matches the 11-char video id in any common YouTube URL form.
_VIDEO_ID_RE = re.compile(
    r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([0-9A-Za-z_-]{11})"
)
_BARE_ID_RE = re.compile(r"^[0-9A-Za-z_-]{11}$")

_SUPADATA_ENDPOINT = "https://api.supadata.ai/v1/youtube/transcript"
_HTTP_TIMEOUT_S = 30.0


class _SupadataError(Exception):
    """Internal: Supadata couldn't return a usable transcript.

    Carries an ``error_type`` matching the public error vocabulary so the
    caller can map it directly into the response dict.
    """

    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message


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
# Public entry point
# ---------------------------------------------------------------------------


def ingest_video(url: str) -> dict[str, Any]:
    """Fetch a YouTube transcript and chunk it into ~500-token segments.

    Possible ``error_type`` values:
        - ``invalid_url``           the URL didn't contain a recognisable video id
        - ``no_api_key``            ``SUPADATA_API_KEY`` is not set in the environment
        - ``video_unavailable``     Supadata couldn't access this video (private, removed, blocked)
        - ``transcripts_disabled``  the owner disabled captions on this video
        - ``no_transcript``         no transcript exists for this video
        - ``rate_limited``          Supadata rate limit hit
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

    # Use a canonical URL so we don't pass through user-specific query params
    # (?t=, ?list=, &si=…) that may confuse upstream.
    canonical_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        segments = _fetch_via_supadata(canonical_url)
    except _SupadataError as exc:
        return _humanize_error(exc.error_type, exc.message, video_id)
    except Exception as exc:  # noqa: BLE001 — last-resort guard
        logger.warning("Unexpected ingestion error for %s: %s", video_id, exc)
        return {
            "success": False,
            "error_type": "fetch_failed",
            "error": f"Failed to fetch transcript for {video_id}: {exc}",
        }

    chunks = _chunk_segments(segments)
    return {"success": True, "video_id": video_id, "chunks": chunks}


# ---------------------------------------------------------------------------
# Supadata client
# ---------------------------------------------------------------------------


def _fetch_via_supadata(url: str) -> list[dict[str, Any]]:
    """Fetch transcript segments from Supadata.

    Returns a list of ``{text, start, duration}`` dicts where ``start`` and
    ``duration`` are seconds (converted from Supadata's milliseconds).
    Raises ``_SupadataError`` on any failure mode.
    """
    api_key = os.getenv("SUPADATA_API_KEY")
    if not api_key:
        raise _SupadataError(
            "no_api_key",
            "SUPADATA_API_KEY is not set in the environment.",
        )

    params = urllib.parse.urlencode({"url": url, "text": "false"})
    full_url = f"{_SUPADATA_ENDPOINT}?{params}"
    request = urllib.request.Request(full_url, headers={"x-api-key": api_key})

    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        error_type, message = _classify_http_error(exc.code, body)
        raise _SupadataError(error_type, message) from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise _SupadataError(
            "fetch_failed", f"Network error calling Supadata: {exc}"
        ) from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise _SupadataError(
            "fetch_failed", f"Supadata returned non-JSON: {exc}"
        ) from exc

    # Some APIs return HTTP 200 with an error field in the body.
    if isinstance(data, dict) and "error" in data and "content" not in data:
        raise _SupadataError(
            "fetch_failed", f"Supadata error: {data.get('error')}"
        )

    raw_segments = data.get("content") if isinstance(data, dict) else None
    if not isinstance(raw_segments, list) or not raw_segments:
        raise _SupadataError(
            "no_transcript",
            "Supadata returned no transcript segments for this video.",
        )

    segments: list[dict[str, Any]] = []
    for s in raw_segments:
        if not isinstance(s, dict):
            continue
        text = (s.get("text") or "").strip()
        if not text:
            continue
        # offset and duration arrive in milliseconds — convert to seconds.
        try:
            offset_ms = float(s.get("offset", 0))
            duration_ms = float(s.get("duration", 0))
        except (TypeError, ValueError):
            continue
        segments.append(
            {
                "text": text,
                "start": offset_ms / 1000.0,
                "duration": duration_ms / 1000.0,
            }
        )

    if not segments:
        raise _SupadataError(
            "no_transcript",
            "Transcript came back empty after parsing.",
        )
    return segments


def _classify_http_error(code: int, body: str) -> tuple[str, str]:
    """Map a Supadata HTTP error response to ``(error_type, message)``."""
    msg = _extract_error_message(body)
    lower = msg.lower()

    if code in (401, 403):
        return "no_api_key", f"Supadata authentication failed: {msg}"
    if code == 429:
        return "rate_limited", f"Supadata rate limit hit: {msg}"
    if code == 404:
        return "video_unavailable", f"Supadata says the video is unavailable: {msg}"
    if code in (400, 422):
        if any(s in lower for s in ("disabled", "captions are off", "captions disabled")):
            return "transcripts_disabled", msg
        if any(s in lower for s in ("private", "removed", "not found", "unavailable")):
            return "video_unavailable", msg
        if any(s in lower for s in ("no transcript", "transcript not", "not available", "no captions")):
            return "no_transcript", msg
        # Default for unknown 4xx — most likely a per-video issue.
        return "no_transcript", msg
    return "fetch_failed", f"Supadata HTTP {code}: {msg}"


def _extract_error_message(body: str) -> str:
    """Pull a human-readable error message out of a Supadata error body."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body[:200] or "(empty body)"

    if isinstance(data, dict):
        # Common shapes: {"message": "..."}, {"error": "..."},
        # {"error": {"message": "..."}}.
        if isinstance(data.get("message"), str):
            return data["message"]
        err = data.get("error")
        if isinstance(err, str):
            return err
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            return err["message"]
    return str(data)[:200]


def _humanize_error(error_type: str, message: str, video_id: str) -> dict[str, Any]:
    """Map a known error_type + raw upstream message to a user-facing response."""
    if error_type == "no_api_key":
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "SUPADATA_API_KEY is not set in the environment.",
        }
    if error_type == "video_unavailable":
        return {
            "success": False,
            "error_type": "video_unavailable",
            "error": (
                f"Supadata couldn't access video {video_id}. The most common "
                "causes are: the video is private or unlisted, it has been "
                "removed by the uploader, or it's blocked in this region."
            ),
        }
    if error_type == "transcripts_disabled":
        return {
            "success": False,
            "error_type": "transcripts_disabled",
            "error": (
                f"The owner of video {video_id} has disabled captions, so we "
                "can't fetch a transcript. Pick a video that has subtitles or "
                "auto-captions enabled."
            ),
        }
    if error_type == "no_transcript":
        return {
            "success": False,
            "error_type": "no_transcript",
            "error": (
                f"No transcript could be found for video {video_id}. "
                "The video may be too new for auto-captions, or captions may "
                "have been generated in an unsupported language."
            ),
        }
    if error_type == "rate_limited":
        return {
            "success": False,
            "error_type": "rate_limited",
            "error": (
                "Supadata rate limit hit. Try again in a minute, or upgrade "
                "your Supadata plan if this happens often."
            ),
        }
    return {
        "success": False,
        "error_type": "fetch_failed",
        "error": f"Failed to fetch transcript for {video_id}: {message}",
    }


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def _chunk_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate raw transcript segments into ~500-token chunks, keeping timestamps."""
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

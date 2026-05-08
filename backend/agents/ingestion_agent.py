"""Ingestion agent.

Takes a YouTube URL, fetches its transcript, and chunks it into ~500-token
segments while preserving start/end times.

Public API
----------
    ingest_video(url) -> dict
        On success: {"success": True, "video_id": str, "chunks": [...]}
        On failure: {"success": False, "error_type": str, "error": str}

    extract_video_id(url) -> str
        Helper that parses any common YouTube URL form (or accepts a bare 11-char id).
        Raises ValueError on unrecognised input.
"""
from __future__ import annotations

import re
from typing import Any

from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)

# English text averages ~1.33 tokens per whitespace-separated word for both the
# OpenAI and Gemini tokenizers. The spec says "roughly 500 tokens", so a word-based
# heuristic is enough — no need to pull in tiktoken.
_TOKENS_PER_WORD = 1.33
_TARGET_TOKENS = 500
_TARGET_WORDS = int(_TARGET_TOKENS / _TOKENS_PER_WORD)  # ≈ 376

# Matches the 11-char video id in any common YouTube URL form.
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


def ingest_video(url: str) -> dict[str, Any]:
    """Fetch a YouTube transcript and chunk it into ~500-token segments.

    Possible ``error_type`` values:
        - ``invalid_url``           the URL didn't contain a recognisable video id
        - ``video_unavailable``     private, removed, deleted, or doesn't exist
        - ``region_blocked``        blocked in the server's region
        - ``age_restricted``        age-restricted; YouTube blocks programmatic access
        - ``ip_blocked``            YouTube has rate-limited / blocked this IP
        - ``transcripts_disabled``  the owner disabled captions on this video
        - ``no_transcript``         no transcript exists in any available language
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
        fetched = YouTubeTranscriptApi().fetch(video_id)
    except VideoUnavailable:
        return {
            "success": False,
            "error_type": "video_unavailable",
            "error": (
                f"YouTube says video {video_id} is unavailable. The most common "
                "causes are: the video is private or unlisted, it has been "
                "removed by the uploader, or it never existed at this ID. "
                "Try a public video instead."
            ),
        }
    except TranscriptsDisabled:
        return {
            "success": False,
            "error_type": "transcripts_disabled",
            "error": (
                f"The owner of video {video_id} has disabled captions, so we "
                "can't fetch a transcript. Pick a video that has subtitles or "
                "auto-captions enabled."
            ),
        }
    except NoTranscriptFound:
        return {
            "success": False,
            "error_type": "no_transcript",
            "error": (
                f"No transcript could be found for video {video_id} in any "
                "language. The video may be too new for auto-captions, or "
                "captions may have been generated in an unsupported language."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        # New-in-1.x exceptions (AgeRestricted, IpBlocked, RequestBlocked,
        # VideoUnplayable) may not exist on older installations, so we route by
        # class name rather than importing them eagerly.
        name = type(exc).__name__

        if name == "AgeRestricted":
            return {
                "success": False,
                "error_type": "age_restricted",
                "error": (
                    f"Video {video_id} is age-restricted. YouTube only serves "
                    "the transcript to authenticated users for these, so we "
                    "can't access it programmatically."
                ),
            }
        if name in {"IpBlocked", "RequestBlocked", "YouTubeRequestFailed"}:
            return {
                "success": False,
                "error_type": "ip_blocked",
                "error": (
                    "YouTube has temporarily blocked requests from this IP "
                    "address (often happens after many requests in a short "
                    "window). Try again in a few minutes or from a different "
                    "network."
                ),
            }
        if name == "VideoUnplayable":
            return {
                "success": False,
                "error_type": "video_unavailable",
                "error": (
                    f"YouTube reported video {video_id} as unplayable. It may "
                    "be region-locked, members-only, or otherwise restricted."
                ),
            }
        return {
            "success": False,
            "error_type": "fetch_failed",
            "error": f"Failed to fetch transcript for {video_id}: {exc}",
        }

    segments = [
        {"text": s.text, "start": float(s.start), "duration": float(s.duration)}
        for s in fetched
    ]
    chunks = _chunk_segments(segments)
    return {"success": True, "video_id": video_id, "chunks": chunks}


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

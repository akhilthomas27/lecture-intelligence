"""Ingestion agent.

Takes a YouTube URL, fetches its transcript, and chunks it into ~500-token
segments while preserving start/end times.

Transcript fetching strategy
----------------------------
1. **Official YouTube Data API v3** (when ``YOUTUBE_API_KEY`` is set in env):
   - ``captions.list`` to discover available caption tracks for the video
     (this works with just an API key).
   - ``captions.download`` to fetch the caption content as srv1 XML.

   ⚠️  ``captions.download`` officially **requires OAuth 2.0** — an API key
   alone returns 403 ("permissions are not sufficient") for nearly all videos
   the requester does not own. So in practice this path will fail the
   download step for most public videos and we transparently fall back.

2. **youtube-transcript-api fallback**: scrapes the same internal timedtext
   endpoint that web players use. Works without authentication for any
   public video that has captions enabled.

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

import html
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)

logger = logging.getLogger(__name__)

# English text averages ~1.33 tokens per whitespace-separated word for both the
# OpenAI and Gemini tokenizers. The spec says "roughly 500 tokens", so a
# word-based heuristic is enough — no need to pull in tiktoken.
_TOKENS_PER_WORD = 1.33
_TARGET_TOKENS = 500
_TARGET_WORDS = int(_TARGET_TOKENS / _TOKENS_PER_WORD)  # ≈ 376

# Matches the 11-char video id in any common YouTube URL form.
_VIDEO_ID_RE = re.compile(
    r"(?:v=|/v/|youtu\.be/|/embed/|/shorts/|/live/)([0-9A-Za-z_-]{11})"
)
_BARE_ID_RE = re.compile(r"^[0-9A-Za-z_-]{11}$")

_YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
_HTTP_TIMEOUT_S = 10.0


class _OfficialApiUnavailable(Exception):
    """Internal sentinel: the official-API path could not produce a transcript.

    Raised for any expected failure mode — no captions listed, OAuth-required
    download error, malformed response, etc. — so the caller can transparently
    fall back to ``youtube-transcript-api``.
    """


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
# Transcript fetching: official API → fallback
# ---------------------------------------------------------------------------


def _fetch_transcript(video_id: str) -> list[dict[str, Any]]:
    """Return ``[{text, start, duration}, ...]`` segments for a video.

    Tries the official YouTube Data API v3 first when ``YOUTUBE_API_KEY`` is
    set. Any failure on the official path falls back to the
    youtube-transcript-api scraping path; the latter's exceptions
    (``VideoUnavailable``, ``TranscriptsDisabled``, ``NoTranscriptFound``,
    etc.) are allowed to propagate so ``ingest_video`` can map them to clear
    user-facing errors.
    """
    api_key = os.getenv("YOUTUBE_API_KEY")
    if api_key:
        try:
            return _fetch_via_official_api(video_id, api_key)
        except _OfficialApiUnavailable as exc:
            logger.info(
                "Official YouTube API didn't yield captions for %s: %s. "
                "Falling back to youtube-transcript-api.",
                video_id,
                exc,
            )
        except Exception as exc:  # noqa: BLE001 — anything unexpected → fall back
            logger.warning(
                "Unexpected error in official YouTube API path for %s: %s. "
                "Falling back to youtube-transcript-api.",
                video_id,
                exc,
            )

    return _fetch_via_youtube_transcript_api(video_id)


def _fetch_via_official_api(video_id: str, api_key: str) -> list[dict[str, Any]]:
    """YouTube Data API v3: ``captions.list`` + ``captions.download``.

    Raises ``_OfficialApiUnavailable`` for any expected failure (no tracks,
    OAuth required for download, empty body, malformed XML, etc.).
    """
    # Step 1: list available caption tracks. Works with just an API key.
    list_data = _http_get_json(
        f"{_YOUTUBE_API_BASE}/captions",
        {"videoId": video_id, "part": "id,snippet", "key": api_key},
    )
    items = list_data.get("items", [])
    if not items:
        raise _OfficialApiUnavailable(
            "captions.list returned no caption tracks for this video"
        )

    track = _pick_caption_track(items)
    caption_id = track.get("id")
    if not caption_id:
        raise _OfficialApiUnavailable("Picked caption track has no id")

    # Step 2: download the caption track.
    # ⚠️ This call typically returns 403 with just an API key — captions.download
    # requires OAuth 2.0 for any video the requester doesn't own. The 403 path
    # raises _OfficialApiUnavailable so we transparently fall back.
    xml_text = _http_get_text(
        f"{_YOUTUBE_API_BASE}/captions/{caption_id}",
        {"tfmt": "srv1", "key": api_key},
    )

    return _parse_srv1(xml_text)


def _pick_caption_track(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Pick the best caption track. Prefer English, prefer non-ASR over ASR."""
    def score(item: dict[str, Any]) -> tuple:
        snippet = item.get("snippet") or {}
        language = (snippet.get("language") or "").lower()
        is_english = language.startswith("en")
        is_manual = snippet.get("trackKind") != "ASR"
        return (is_english, is_manual)
    return max(items, key=score)


def _parse_srv1(xml_text: str) -> list[dict[str, Any]]:
    """Parse YouTube's srv1 XML caption format.

    srv1 looks like::

        <transcript>
          <text start="0.5" dur="2.3">Hello &amp; welcome</text>
          ...
        </transcript>
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise _OfficialApiUnavailable(f"Could not parse srv1 XML: {exc}") from exc

    segments: list[dict[str, Any]] = []
    for elem in root.iter("text"):
        text = (elem.text or "").strip()
        if not text:
            continue
        try:
            start = float(elem.get("start", "0"))
            duration = float(elem.get("dur", "0"))
        except (TypeError, ValueError):
            continue
        text = html.unescape(text).replace("\n", " ").strip()
        if not text:
            continue
        segments.append({"text": text, "start": start, "duration": duration})

    if not segments:
        raise _OfficialApiUnavailable("Empty transcript from official API")
    return segments


def _fetch_via_youtube_transcript_api(video_id: str) -> list[dict[str, Any]]:
    """Fallback: scrape via the youtube-transcript-api package."""
    fetched = YouTubeTranscriptApi().fetch(video_id)
    return [
        {"text": s.text, "start": float(s.start), "duration": float(s.duration)}
        for s in fetched
    ]


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib so we don't add a dependency for two GETs)
# ---------------------------------------------------------------------------


def _http_get_json(url: str, params: dict[str, str]) -> dict[str, Any]:
    body = _http_get_text(url, params)
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise _OfficialApiUnavailable(f"Response was not JSON: {exc}") from exc


def _http_get_text(url: str, params: dict[str, str]) -> str:
    full_url = f"{url}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(full_url, timeout=_HTTP_TIMEOUT_S) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        # 403 here is the typical OAuth-required-for-download outcome.
        raise _OfficialApiUnavailable(
            f"HTTP {exc.code} from {url}: {body[:200]}"
        ) from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise _OfficialApiUnavailable(f"Network error calling {url}: {exc}") from exc


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def ingest_video(url: str) -> dict[str, Any]:
    """Fetch a YouTube transcript and chunk it into ~500-token segments.

    Possible ``error_type`` values:
        - ``invalid_url``           the URL didn't contain a recognisable video id
        - ``video_unavailable``     private, removed, deleted, or doesn't exist
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
        segments = _fetch_transcript(video_id)
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
        # New-in-1.x exceptions on the youtube-transcript-api fallback path.
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

    chunks = _chunk_segments(segments)
    return {"success": True, "video_id": video_id, "chunks": chunks}


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

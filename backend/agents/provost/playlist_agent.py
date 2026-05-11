"""Playlist agent.

Fetches all video URLs from a YouTube playlist via Supadata API.
Returns list of video URLs or error if playlist has more than 15 videos.
"""
from __future__ import annotations

import os
import re
import requests
from typing import Any

from dotenv import load_dotenv

load_dotenv()

SUPADATA_API_KEY = os.getenv("SUPADATA_API_KEY")
_SUPADATA_PLAYLIST_ENDPOINT = "https://api.supadata.ai/v1/youtube/playlist"
_SUPADATA_PLAYLIST_VIDEOS_ENDPOINT = "https://api.supadata.ai/v1/youtube/playlist/videos"
_REQUEST_TIMEOUT = 30.0
_MAX_VIDEOS = 15

_PLAYLIST_ID_RE = re.compile(r"(?:list=)([A-Za-z0-9_-]+)")

if SUPADATA_API_KEY:
    print("[playlist_agent] SUPADATA_API_KEY: found in environment ✓")
else:
    print("[playlist_agent] SUPADATA_API_KEY: NOT FOUND")


def extract_playlist_id(url: str) -> str:
    """Extract playlist ID from any YouTube playlist URL format."""
    candidate = (url or "").strip()
    if not candidate:
        raise ValueError("URL is empty")
    match = _PLAYLIST_ID_RE.search(candidate)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract a playlist ID from: {url!r}")


def fetch_playlist_videos(playlist_url: str) -> dict[str, Any]:

    # Validate URL
    try:
        playlist_id = extract_playlist_id(playlist_url)
    except ValueError as exc:
        return {
            "success": False,
            "error_type": "invalid_url",
            "error": f"That doesn't look like a valid YouTube playlist URL. {exc}",
        }

    api_key = SUPADATA_API_KEY
    if not api_key:
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "SUPADATA_API_KEY is not set in the environment.",
        }

    # Single API call — get video IDs directly
    try:
        response = requests.get(
            _SUPADATA_PLAYLIST_VIDEOS_ENDPOINT,
            params={"id": playlist_id},
            headers={"x-api-key": api_key},
            timeout=_REQUEST_TIMEOUT,
        )

        if response.status_code in (401, 403):
            return {
                "success": False,
                "error_type": "no_api_key",
                "error": "Supadata API key is invalid or rejected.",
            }
        if response.status_code == 404:
            return {
                "success": False,
                "error_type": "playlist_unavailable",
                "error": "Playlist not found. It may be private or deleted.",
            }
        if response.status_code == 429:
            return {
                "success": False,
                "error_type": "rate_limited",
                "error": "Too many requests. Please wait a moment and try again.",
            }

        response.raise_for_status()
        data = response.json()

    except requests.exceptions.Timeout:
        return {
            "success": False,
            "error_type": "fetch_failed",
            "error": "Request timed out. Try again.",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "success": False,
            "error_type": "fetch_failed",
            "error": f"Failed to fetch playlist videos: {exc}",
        }

    # Parse videoIds
    video_ids = data.get("videoIds", [])

    if not video_ids:
        return {
            "success": False,
            "error_type": "empty_playlist",
            "error": "No accessible videos found in this playlist.",
        }

    # Check count AFTER fetching — no separate metadata call needed
    video_count = len(video_ids)

    if video_count > _MAX_VIDEOS:
        return {
            "success": False,
            "error_type": "too_many_videos",
            "error": (
                f"This playlist has {video_count} videos. "
                f"Please use a playlist with {_MAX_VIDEOS} or fewer videos."
            ),
            "video_count": video_count,
        }

    # Build video list
    videos = [
        {
            "url": f"https://www.youtube.com/watch?v={vid_id}",
            "title": f"Lecture {i + 1}",
        }
        for i, vid_id in enumerate(video_ids)
    ]

    return {
        "success": True,
        "video_count": len(videos),
        "videos": videos,
    }
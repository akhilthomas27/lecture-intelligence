"""Curriculum agent.

Takes a list of transcript chunks (from the ingestion agent) and asks
Gemini 2.5 Flash to produce structured study materials: an outline, three
summaries of varying lengths, and a deck of flashcards.

Public API
----------
    generate_curriculum(chunks) -> dict
        On success::

            {
                "success": True,
                "outline": [...],
                "summary_90s": "...",
                "summary_5min": "...",
                "full_summary": "...",
                "flashcards": [...],
            }

        On failure::

            {"success": False, "error_type": str, "error": str}
"""
from __future__ import annotations

import json
import os
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

MODEL = "gemini-2.5-flash"
TEMPERATURE = 0.2

_REQUIRED_KEYS = {
    "outline",
    "summary_90s",
    "summary_5min",
    "full_summary",
    "flashcards",
}

SYSTEM_PROMPT = """You are an expert study guide author. You are given the
transcript of a recorded lecture, broken into chunks tagged with start times
in seconds. Your job is to produce structured study materials.

Return ONLY a single JSON object matching the schema given by the user. Do not
wrap the JSON in markdown code fences. Do not include any prose, headers, or
commentary outside the JSON. Do not invent information that is not supported
by the transcript."""

USER_PROMPT_TEMPLATE = """Lecture transcript chunks (each prefixed with start_time in seconds):

{chunks}

Return a single JSON object with this EXACT shape:

{{
  "outline": [
    {{
      "title": "<section title>",
      "level": <integer 1, 2, or 3 — 1 = top-level section, 2 = subsection, 3 = sub-subsection>,
      "start_time": <seconds, drawn from the chunk timestamps above>,
      "summary": "<1-2 sentence summary of this section>"
    }}
  ],
  "summary_90s": "<a coherent summary that takes about 90 seconds to read aloud (~225 words). Plain text, no markdown.>",
  "summary_5min": "<a thorough summary that takes about 5 minutes to read aloud (~750 words). Plain text, no markdown.>",
  "full_summary": "<a comprehensive section-by-section summary covering the entire lecture. Plain text, no markdown.>",
  "flashcards": [
    {{
      "question": "<a single, clear question about a key concept>",
      "answer": "<a precise, self-contained answer>",
      "source_timestamp": <seconds, where in the lecture this is discussed>,
      "source_text": "<a short verbatim excerpt from the transcript (under 30 words) that supports the answer>"
    }}
  ]
}}

Constraints:
- Outline: 3-10 items, ordered chronologically.
- Flashcards: 8-15 cards covering the most important concepts.
- All timestamps are numbers (seconds), not strings.
- Every source_text quote must be drawn from the transcript chunks above.
- Output JSON only — no code fences, no commentary, nothing else."""


def generate_curriculum(chunks: list[dict[str, Any]]) -> dict[str, Any]:
    """Send chunks to Gemini and return structured study materials.

    Possible ``error_type`` values:
        - ``no_chunks``         the chunks list was empty
        - ``no_api_key``        ``GEMINI_API_KEY`` is not set in the environment
        - ``api_error``         the Gemini call failed (network / auth / quota / etc.)
        - ``invalid_json``      response could not be parsed as JSON
        - ``schema_mismatch``   JSON parsed but is missing required top-level keys
    """
    if not chunks:
        return {
            "success": False,
            "error_type": "no_chunks",
            "error": "No chunks provided to curriculum agent.",
        }

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "GEMINI_API_KEY is not set in the environment.",
        }

    rendered = "\n\n".join(
        f"[{float(c['start_time']):.1f}s] {c['text']}" for c in chunks
    )
    user_prompt = USER_PROMPT_TEMPLATE.format(chunks=rendered)

    try:
        llm = ChatGoogleGenerativeAI(
            model=MODEL,
            google_api_key=api_key,
            temperature=TEMPERATURE,
        )
        response = llm.invoke(
            [
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=user_prompt),
            ]
        )
    except Exception as exc:  # noqa: BLE001 — surface any upstream failure
        return {
            "success": False,
            "error_type": "api_error",
            "error": f"Gemini call failed: {exc}",
        }

    raw = (
        response.content
        if isinstance(response.content, str)
        else str(response.content)
    )

    try:
        data = _parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        return {
            "success": False,
            "error_type": "invalid_json",
            "error": f"Could not parse Gemini response as JSON: {exc}",
        }

    missing = _REQUIRED_KEYS - set(data.keys())
    if missing:
        return {
            "success": False,
            "error_type": "schema_mismatch",
            "error": (
                f"Gemini response is missing required keys: {sorted(missing)}. "
                f"Got: {sorted(data.keys())}."
            ),
        }

    return {
        "success": True,
        "outline": data["outline"],
        "summary_90s": data["summary_90s"],
        "summary_5min": data["summary_5min"],
        "full_summary": data["full_summary"],
        "flashcards": data["flashcards"],
    }


def _parse_json(raw: str) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from a model response.

    Handles the common cases where the model adds ``” ```json ... ``` ”`` fences
    or wraps the JSON in extra prose despite our instructions.
    """
    cleaned = raw.strip()

    # Strip ```json ... ``` or ``` ... ``` fences.
    if cleaned.startswith("```"):
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1 :]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3].rstrip()

    # Slice out the outermost {...} in case extra prose surrounds it.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found in response")

    return json.loads(cleaned[start : end + 1])

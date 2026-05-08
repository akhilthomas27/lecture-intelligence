"""Translation agent.

Takes the structured study materials (outline, summaries, flashcards) produced
by the curriculum agent and asks Gemini 2.0 Flash to translate every text
field into a target language, preserving the JSON structure exactly.

Numeric fields (``start_time``, ``level``, ``source_timestamp``) are passed
through unchanged.

Public API
----------
    translate_materials(outline, summaries, flashcards, target_language) -> dict
        On success: {"success": True, "outline": [...], "summaries": {...}, "flashcards": [...]}
        On failure: {"success": False, "error_type": str, "error": str}
"""
from __future__ import annotations

import json
import os
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

MODEL = "gemini-2.5-flash"
TEMPERATURE = 0.2

_REQUIRED_KEYS = {"outline", "summaries", "flashcards"}

SYSTEM_PROMPT = """You are an expert translator. You are given study materials
extracted from a lecture: an outline, three summaries of varying length, and
a deck of flashcards. Translate every text field into the target language
specified by the user, preserving the JSON structure exactly.

Hard rules:
- Translate ALL text fields (titles, summaries, questions, answers, source quotes).
- Do NOT modify numeric fields (start_time, level, source_timestamp). Pass them through unchanged.
- Do NOT change the JSON shape, key names, ordering, or array lengths.
- Return ONLY a single JSON object — no markdown code fences, no commentary."""

USER_PROMPT_TEMPLATE = """Translate the following study materials into {target_language}.

Input JSON:
{payload}

Return JSON with this EXACT same shape:
{{
  "outline": [
    {{
      "title": "<translated>",
      "level": <unchanged number>,
      "start_time": <unchanged number>,
      "summary": "<translated>"
    }}
  ],
  "summaries": {{
    "summary_90s": "<translated>",
    "summary_5min": "<translated>",
    "full_summary": "<translated>"
  }},
  "flashcards": [
    {{
      "question": "<translated>",
      "answer": "<translated>",
      "source_timestamp": <unchanged number>,
      "source_text": "<translated>"
    }}
  ]
}}

Output JSON only — no code fences, no commentary, nothing else."""


def translate_materials(
    outline: list[dict[str, Any]],
    summaries: dict[str, str],
    flashcards: list[dict[str, Any]],
    target_language: str,
) -> dict[str, Any]:
    """Translate study materials into ``target_language``.

    Possible ``error_type`` values:
        - ``no_language``       ``target_language`` is empty
        - ``no_api_key``        ``GEMINI_API_KEY`` is not set in the environment
        - ``api_error``         the Gemini call failed (network / auth / quota / etc.)
        - ``invalid_json``      response could not be parsed as JSON
        - ``schema_mismatch``   JSON parsed but is missing required top-level keys
    """
    if not target_language or not target_language.strip():
        return {
            "success": False,
            "error_type": "no_language",
            "error": "target_language is empty.",
        }

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "GEMINI_API_KEY is not set in the environment.",
        }

    payload = json.dumps(
        {
            "outline": outline,
            "summaries": summaries,
            "flashcards": flashcards,
        },
        ensure_ascii=False,
        indent=2,
    )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        target_language=target_language.strip(),
        payload=payload,
    )

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
    except Exception as exc:  # noqa: BLE001
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
                f"Translation response is missing required keys: {sorted(missing)}. "
                f"Got: {sorted(data.keys())}."
            ),
        }

    return {
        "success": True,
        "outline": data["outline"],
        "summaries": data["summaries"],
        "flashcards": data["flashcards"],
    }


def _parse_json(raw: str) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from a model response."""
    cleaned = raw.strip()

    if cleaned.startswith("```"):
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1 :]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3].rstrip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found in response")

    return json.loads(cleaned[start : end + 1])

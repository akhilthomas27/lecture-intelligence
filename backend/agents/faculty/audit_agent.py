"""Faculty audit agent.

Takes a list of transcript chunks (from the ingestion agent) and asks Gemini
to produce a comprehensive lecture audit covering pedagogical clarity,
accessibility, equity & inclusion, and language & tone — the kind of
private feedback a faculty member would want before going live.

Public API
----------
    audit_lecture(chunks) -> dict
        On success::

            {
                "success": True,
                "priority_fix": {...},
                "findings": [...],
                "strengths": [...],
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
TEMPERATURE = 0.3

_REQUIRED_KEYS = {"priority_fix", "findings", "strengths"}

SYSTEM_PROMPT = """You are an expert education auditor reviewing a recorded
lecture for a faculty member who wants to improve. Your feedback is private,
specific, evidence-grounded, and kind. You always cite a verbatim quote from
the transcript when flagging an issue, and you always propose a concrete
rewrite the faculty could actually deliver.

Evaluate the lecture across these four dimensions:

1. PEDAGOGICAL CLARITY
   - Are concepts introduced before being used?
   - Are examples given for abstract concepts?
   - Is there a clear structure (intro, body, conclusion)?
   - Are learning objectives stated at the start?

2. ACCESSIBILITY
   - Is the pace appropriate?
   - Are technical terms explained?
   - Is the language at an appropriate level?
   - Would a student with a learning difference struggle?

3. EQUITY AND INCLUSION
   - Are examples diverse and inclusive?
   - Is any language potentially alienating?
   - Are cultural assumptions made without acknowledgment?

4. LANGUAGE AND TONE
   - Is the tone engaging or dry?
   - Are there filler words or unclear phrasing?
   - Are there moments of particular clarity worth noting?

Return ONLY a single JSON object matching the schema given by the user.
Do not wrap the JSON in markdown code fences. Do not include any prose,
headers, or commentary outside the JSON. Do not invent information that
is not supported by the transcript."""

USER_PROMPT_TEMPLATE = """Lecture transcript chunks (each prefixed with start_time in seconds):

{chunks}

Return a single JSON object with this EXACT shape:

{{
  "priority_fix": {{
    "title": "<short title for the single most impactful change>",
    "issue": "<what's wrong, in one or two sentences>",
    "why_it_matters": "<why fixing this would meaningfully improve the lecture>",
    "timestamp": <seconds, drawn from the chunk timestamps above>,
    "original_text": "<short verbatim quote from the transcript (under 30 words)>",
    "suggested_rewrite": "<concrete rewrite the faculty could deliver instead>"
  }},
  "findings": [
    {{
      "dimension": "<one of: pedagogical | accessibility | equity | language>",
      "title": "<short title for this finding>",
      "issue": "<what to improve, in one or two sentences>",
      "severity": "<one of: high | medium | low>",
      "timestamp": <seconds>,
      "original_text": "<short verbatim quote (under 30 words)>",
      "suggested_rewrite": "<concrete rewrite>"
    }}
  ],
  "strengths": [
    {{
      "title": "<short title for this strength>",
      "description": "<what the faculty did well, encouraging tone>",
      "timestamp": <seconds>
    }}
  ]
}}

Constraints:
- Provide exactly ONE priority_fix — the single most impactful change.
- 4-10 findings total, balanced across the four dimensions when possible.
- 2-5 strengths, with a positive encouraging tone.
- All timestamps must be numbers (seconds), drawn from the chunk timestamps above.
- All original_text quotes must be verbatim and short (under 30 words).
- The priority_fix must NOT also appear in findings (it's already separately surfaced).
- Output JSON only — no code fences, no commentary, nothing else."""


def audit_lecture(chunks: list[dict[str, Any]]) -> dict[str, Any]:
    """Send chunks to Gemini and return a structured lecture audit.

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
            "error": "No chunks provided to audit agent.",
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
                f"Audit response is missing required keys: {sorted(missing)}. "
                f"Got: {sorted(data.keys())}."
            ),
        }

    return {
        "success": True,
        "priority_fix": data["priority_fix"],
        "findings": data["findings"],
        "strengths": data["strengths"],
    }


def _parse_json(raw: str) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from a model response."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        nl = cleaned.find("\n")
        if nl != -1:
            cleaned = cleaned[nl + 1 :]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3].rstrip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found in response")
    return json.loads(cleaned[start : end + 1])

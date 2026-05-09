"""Provost curriculum coverage agent.

Takes multiple lecture transcripts plus a list of stated learning objectives
and asks Gemini to produce a curriculum coverage map: which objectives are
covered, where they're covered, what each lecture actually addresses, and
what gaps exist.

Public API
----------
    map_curriculum(lectures, objectives) -> dict

        ``lectures`` is a list of ``{"url": str, "chunks": [chunk, ...]}``
        ``objectives`` is a free-text string with one objective per line.

        On success::

            {
                "success": True,
                "summary": {...},
                "objectives": [...],
                "lectures": [...],
                "recommendations": [...],
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

_REQUIRED_KEYS = {"summary", "objectives", "lectures", "recommendations"}

SYSTEM_PROMPT = """You are a curriculum design expert helping a provost
verify that a course is delivering on its stated learning objectives.

You evaluate by comparing the actual content of each lecture against each
stated objective, flagging gaps, and proposing concrete fixes. Be honest —
a provost needs accurate signal, not flattery.

For each objective, decide whether it's:
- fully_covered: directly and substantially addressed in at least one lecture
- partially_covered: touched on but not deeply, or only by implication
- not_covered: not addressed in any lecture submitted

Return ONLY a single JSON object matching the schema given by the user.
Do not wrap in code fences. No commentary outside the JSON. Do not invent
content that is not present in the transcripts."""

USER_PROMPT_TEMPLATE = """The course has the following stated learning objectives:

{objectives}

Below are the transcripts of the lectures making up this course. Each chunk
is tagged with its source URL and its start time in seconds.

LECTURES:
{lectures}

Return a single JSON object with this EXACT shape:

{{
  "summary": {{
    "total_objectives": <int>,
    "fully_covered": <int>,
    "partially_covered": <int>,
    "not_covered": <int>,
    "coverage_percentage": <float, 0-100, computed as (fully_covered + 0.5 * partially_covered) / total_objectives * 100>
  }},
  "objectives": [
    {{
      "objective": "<the objective text, verbatim from the input>",
      "status": "<fully_covered | partially_covered | not_covered>",
      "coverage_detail": "<one or two sentences explaining the assessment>",
      "lectures": [
        {{
          "url": "<the lecture URL where this objective is covered (must match an input URL)>",
          "timestamp": <seconds, drawn from a real chunk timestamp>,
          "excerpt": "<short verbatim excerpt (under 30 words) supporting the assessment>"
        }}
      ]
    }}
  ],
  "lectures": [
    {{
      "url": "<lecture URL — must match an input URL>",
      "objectives_covered": <int — how many distinct objectives this lecture addresses>,
      "key_topics": ["<short topic name>", "..."],
      "gaps": ["<short description of what this lecture could have covered but didn't>", "..."]
    }}
  ],
  "recommendations": [
    {{
      "priority": <int — 1 is highest priority>,
      "gap": "<which objective or topic is missing or weak>",
      "suggestion": "<concrete action — which lecture to update, or what content to add>"
    }}
  ]
}}

Constraints:
- The "objectives" array must contain exactly one entry per stated objective above, in the same order.
- For "not_covered" objectives, the "lectures" array under that objective should be empty.
- Every lecture URL submitted must appear in the top-level "lectures" array, even if it covered zero objectives.
- All timestamps must be numbers (seconds), drawn from the chunk timestamps shown above.
- Provide 2-5 prioritized recommendations.
- Output JSON only — no code fences, no commentary, nothing else."""


def map_curriculum(
    lectures: list[dict[str, Any]],
    objectives: str,
) -> dict[str, Any]:
    """Build a curriculum coverage map.

    Possible ``error_type`` values:
        - ``no_lectures``       no lectures were provided
        - ``no_objectives``     objectives string was empty
        - ``no_chunks``         every lecture had an empty chunks list
        - ``no_api_key``        ``GEMINI_API_KEY`` is not set
        - ``api_error``         the Gemini call failed
        - ``invalid_json``      response could not be parsed as JSON
        - ``schema_mismatch``   JSON parsed but is missing required top-level keys
    """
    if not lectures:
        return {
            "success": False,
            "error_type": "no_lectures",
            "error": "No lectures provided to curriculum agent.",
        }
    if not objectives or not objectives.strip():
        return {
            "success": False,
            "error_type": "no_objectives",
            "error": "No learning objectives provided.",
        }
    if not any(lec.get("chunks") for lec in lectures):
        return {
            "success": False,
            "error_type": "no_chunks",
            "error": "All lectures returned empty transcripts.",
        }

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "GEMINI_API_KEY is not set in the environment.",
        }

    rendered_lectures = []
    for lec in lectures:
        url = lec.get("url", "")
        chunks = lec.get("chunks") or []
        if not chunks:
            rendered_lectures.append(
                f"--- LECTURE: {url} ---\n  (no transcript available)"
            )
            continue
        rendered_chunks = "\n".join(
            f"  [{float(c['start_time']):.1f}s] {c['text']}" for c in chunks
        )
        rendered_lectures.append(f"--- LECTURE: {url} ---\n{rendered_chunks}")
    rendered = "\n\n".join(rendered_lectures)

    user_prompt = USER_PROMPT_TEMPLATE.format(
        objectives=objectives.strip(),
        lectures=rendered,
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
                f"Curriculum map is missing required keys: {sorted(missing)}. "
                f"Got: {sorted(data.keys())}."
            ),
        }

    return {
        "success": True,
        "summary": data["summary"],
        "objectives": data["objectives"],
        "lectures": data["lectures"],
        "recommendations": data["recommendations"],
    }


def _parse_json(raw: str) -> dict[str, Any]:
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

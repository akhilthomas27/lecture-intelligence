"""Curriculum agent.

Takes a list of transcript chunks (from the ingestion agent) and asks
Claude Sonnet 4.6 to produce structured study materials: an outline, three
summaries of varying lengths, and a deck of flashcards.

Claude Sonnet 4.6 is used here specifically because:
- Produces the most natural, human-readable prose of any model (May 2026)
- Best quality-to-cost ratio at $3/$15 per 1M tokens
- 1M token context window handles long lectures natively
- Leads on writing quality benchmarks over Gemini and GPT-5.5

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

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

# Claude Sonnet 4.6 — best natural prose quality for summaries and flashcards
# Superior to Gemini for human-readable study material generation
MODEL = "claude-sonnet-4-6"
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

Write summaries in clear, natural, conversational prose — the kind a brilliant
teaching assistant would write, not a robot. Make the content genuinely useful
for a student preparing for an exam.

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
  "summary_90s": "<A 90-second summary (~225 words). Write as 2-3 short punchy paragraphs with NO subheadings. Plain prose only. No markdown.>",
  "summary_5min": "<A 5-minute summary (~750 words). Use this EXACT format with ## subheadings:\n\n## Overview\n<2-3 sentences introducing the lecture topic>\n\n## Core Concepts\n<explain the main ideas covered>\n\n## Key Arguments\n<what the lecturer argues or concludes>\n\n## Examples and Evidence\n<specific examples or evidence used>\n\n## Key Takeaways\n<what students should remember>\n\nUse plain prose under each heading, no bullet points.>",
  "full_summary": "<A comprehensive summary. Use this EXACT format with ## subheadings:\n\n## Introduction\n<what the lecture set out to cover>\n\n## Main Topics\n<detailed coverage of each major topic in order>\n\n## Core Arguments\n<the main points and arguments made>\n\n## Examples and Case Studies\n<specific examples, data, or evidence presented>\n\n## Connections and Implications\n<how topics connect to each other or broader context>\n\n## Conclusion and Takeaways\n<how the lecture concluded and what students should retain>\n\nUse plain prose under each heading, no bullet points.>",
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
    """Send chunks to Claude Sonnet 4.6 and return structured study materials.

    Possible ``error_type`` values:
        - ``no_chunks``         the chunks list was empty
        - ``no_api_key``        ``ANTHROPIC_API_KEY`` is not set in the environment
        - ``api_error``         the Claude call failed (network / auth / quota / etc.)
        - ``invalid_json``      response could not be parsed as JSON
        - ``schema_mismatch``   JSON parsed but is missing required top-level keys
    """
    if not chunks:
        return {
            "success": False,
            "error_type": "no_chunks",
            "error": "No chunks provided to curriculum agent.",
        }

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "ANTHROPIC_API_KEY is not set in the environment.",
        }

    rendered = "\n\n".join(
        f"[{float(c['start_time']):.1f}s] {c['text']}" for c in chunks
    )
    user_prompt = USER_PROMPT_TEMPLATE.format(chunks=rendered)

    try:
        llm = ChatAnthropic(
            model=MODEL,
            anthropic_api_key=api_key,
            temperature=TEMPERATURE,
            max_tokens=8192,
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
            "error": f"Claude Sonnet 4.6 call failed: {exc}",
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
            "error": f"Could not parse Claude response as JSON: {exc}",
        }

    missing = _REQUIRED_KEYS - set(data.keys())
    if missing:
        return {
            "success": False,
            "error_type": "schema_mismatch",
            "error": (
                f"Claude response is missing required keys: {sorted(missing)}. "
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
    """Best-effort extraction of a JSON object from a model response."""
    cleaned = raw.strip()

    if cleaned.startswith("```"):
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1:]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3].rstrip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found in response")

    return json.loads(cleaned[start: end + 1])
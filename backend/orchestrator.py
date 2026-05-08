"""LangGraph orchestrator for the lecture pipeline.

Sequence: ``ingestion → curriculum → search``.

Each node calls its underlying agent. If a node fails it sets
``status="error"`` with a descriptive ``error`` message and the remaining
nodes pass straight through, so the final state always carries the failure
context.

Public API
----------
    run(url: str) -> LectureState
        Run the full pipeline for a URL and return the final state.

    lecture_graph
        The compiled StateGraph (use directly for streaming, async, etc.).

State schema
------------
    video_id           str       set by ingestion node
    url                str       provided by caller
    chunks             list      set by ingestion node
    outline            list      set by curriculum node
    summaries          dict      set by curriculum node — keys:
                                   summary_90s, summary_5min, full_summary
    flashcards         list      set by curriculum node
    embeddings_ready   bool      flipped True by search node on success
    status             str       pending | ingested | curated | complete | error
    error              str|None  populated only when status == "error"
"""
from __future__ import annotations

from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.curriculum_agent import generate_curriculum
from agents.ingestion_agent import ingest_video
from agents.search_agent import index_chunks


class LectureState(TypedDict, total=False):
    video_id: str
    url: str
    chunks: list[dict[str, Any]]
    outline: list[dict[str, Any]]
    summaries: dict[str, str]
    flashcards: list[dict[str, Any]]
    embeddings_ready: bool
    status: str
    error: Optional[str]


# ---------------------------------------------------------------------------
# Nodes
#
# Each node returns a *partial* state update — LangGraph merges the dict into
# the running state, replacing only the keys we set. The first thing every
# node does is short-circuit (return {}) when an earlier node has already
# flipped status to "error", so a single failure cleanly aborts the rest of
# the pipeline without losing the error context.
# ---------------------------------------------------------------------------


def ingestion_node(state: LectureState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    try:
        result = ingest_video(state.get("url", ""))
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"ingestion crashed: {exc}"}

    if not result.get("success"):
        return {
            "status": "error",
            "error": (
                f"ingestion ({result.get('error_type')}): "
                f"{result.get('error')}"
            ),
        }

    return {
        "video_id": result["video_id"],
        "chunks": result["chunks"],
        "status": "ingested",
    }


def curriculum_node(state: LectureState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    try:
        result = generate_curriculum(state.get("chunks", []))
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"curriculum crashed: {exc}"}

    if not result.get("success"):
        return {
            "status": "error",
            "error": (
                f"curriculum ({result.get('error_type')}): "
                f"{result.get('error')}"
            ),
        }

    return {
        "outline": result["outline"],
        "summaries": {
            "summary_90s": result["summary_90s"],
            "summary_5min": result["summary_5min"],
            "full_summary": result["full_summary"],
        },
        "flashcards": result["flashcards"],
        "status": "curated",
    }


def search_node(state: LectureState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    try:
        result = index_chunks(
            state.get("video_id", ""),
            state.get("chunks", []),
        )
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"search crashed: {exc}"}

    if not result.get("success"):
        return {
            "status": "error",
            "error": (
                f"search ({result.get('error_type')}): "
                f"{result.get('error')}"
            ),
        }

    return {
        "embeddings_ready": True,
        "status": "complete",
    }


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_graph():
    g = StateGraph(LectureState)
    g.add_node("ingestion", ingestion_node)
    g.add_node("curriculum", curriculum_node)
    g.add_node("search", search_node)

    g.add_edge(START, "ingestion")
    g.add_edge("ingestion", "curriculum")
    g.add_edge("curriculum", "search")
    g.add_edge("search", END)

    return g.compile()


# Module-level compiled graph; reuse across requests.
lecture_graph = build_graph()


def run(url: str) -> LectureState:
    """Run the full pipeline for ``url`` and return the final state.

    On success, ``status`` will be ``"complete"`` and ``embeddings_ready``
    will be ``True``. On any failure, ``status`` will be ``"error"`` and
    ``error`` will contain a descriptive message naming the failing stage.
    """
    initial: LectureState = {
        "url": url,
        "status": "pending",
        "embeddings_ready": False,
        "error": None,
    }
    return lecture_graph.invoke(initial)

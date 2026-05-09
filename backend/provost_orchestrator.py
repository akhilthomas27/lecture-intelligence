"""LangGraph orchestrator for the provost curriculum-coverage pipeline.

Sequence: ``multi_ingestion → curriculum_map``.

The first node loops over every submitted URL and calls ``ingest_video`` on
each, accumulating chunks under their source URL. The second node passes
the combined corpus + objectives to the curriculum agent.

Public API
----------
    run_provost(urls: list[str], objectives: str) -> ProvostState
        Run the full pipeline and return the final state.

    provost_graph
        The compiled StateGraph.

State schema
------------
    urls             list[str]  provided by caller
    objectives       str        provided by caller (free-text, one per line)
    all_chunks       list[dict] set by multi_ingestion node — list of
                                {"url": str, "chunks": [...]} entries
    failed_lectures  list[dict] set by multi_ingestion node — URLs that
                                couldn't be transcribed (informational)
    curriculum_map   dict       set by curriculum_node — keys: summary,
                                objectives, lectures, recommendations
    status           str        pending | ingesting | ingested |
                                complete | error
    error            str|None   populated only when status == "error"
"""
from __future__ import annotations

from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.ingestion_agent import ingest_video
from agents.provost.curriculum_agent import map_curriculum


class ProvostState(TypedDict, total=False):
    urls: list[str]
    objectives: str
    all_chunks: list[dict[str, Any]]
    failed_lectures: list[dict[str, Any]]
    curriculum_map: dict[str, Any]
    status: str
    error: Optional[str]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


def multi_ingestion_node(state: ProvostState) -> dict[str, Any]:
    """Ingest every URL in turn. A single bad URL doesn't kill the run —
    we log it under ``failed_lectures`` and proceed with the rest, so a
    course with one private video still gets a partial coverage map.
    The whole pipeline only errors out if EVERY URL fails."""
    if state.get("status") == "error":
        return {}

    urls = state.get("urls") or []
    if not urls:
        return {"status": "error", "error": "ingestion: no URLs provided"}

    all_chunks: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for url in urls:
        try:
            result = ingest_video(url)
        except Exception as exc:  # noqa: BLE001
            failed.append({"url": url, "error_type": "crashed", "error": str(exc)})
            continue
        if not result.get("success"):
            failed.append(
                {
                    "url": url,
                    "error_type": result.get("error_type"),
                    "error": result.get("error"),
                }
            )
            continue
        all_chunks.append(
            {
                "url": url,
                "video_id": result["video_id"],
                "chunks": result["chunks"],
            }
        )

    if not all_chunks:
        # Every URL failed — surface the first failure as the headline error.
        first = failed[0] if failed else {"error": "no chunks produced"}
        return {
            "status": "error",
            "error": (
                f"ingestion: all {len(urls)} lecture(s) failed. "
                f"First failure: {first.get('error_type')}: {first.get('error')}"
            ),
            "failed_lectures": failed,
        }

    return {
        "all_chunks": all_chunks,
        "failed_lectures": failed,
        "status": "ingested",
    }


def curriculum_node(state: ProvostState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    lectures = state.get("all_chunks") or []
    objectives = state.get("objectives", "")

    try:
        result = map_curriculum(lectures, objectives)
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"curriculum mapping crashed: {exc}"}

    if not result.get("success"):
        return {
            "status": "error",
            "error": (
                f"curriculum ({result.get('error_type')}): {result.get('error')}"
            ),
        }

    return {
        "curriculum_map": {
            "summary": result["summary"],
            "objectives": result["objectives"],
            "lectures": result["lectures"],
            "recommendations": result["recommendations"],
        },
        "status": "complete",
    }


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_graph():
    g = StateGraph(ProvostState)
    g.add_node("multi_ingestion", multi_ingestion_node)
    g.add_node("curriculum_map", curriculum_node)

    g.add_edge(START, "multi_ingestion")
    g.add_edge("multi_ingestion", "curriculum_map")
    g.add_edge("curriculum_map", END)

    return g.compile()


provost_graph = build_graph()


def run_provost(urls: list[str], objectives: str) -> ProvostState:
    """Run the provost coverage pipeline and return the final state."""
    initial: ProvostState = {
        "urls": urls,
        "objectives": objectives,
        "status": "pending",
        "error": None,
    }
    return provost_graph.invoke(initial)

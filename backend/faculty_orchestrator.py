"""LangGraph orchestrator for the faculty audit pipeline.

Sequence: ``ingestion → faculty_audit``.

Each node calls its underlying agent. If a node fails it sets
``status="error"`` with a descriptive ``error`` message and the next node
passes through, so the final state always carries the failure context.

Public API
----------
    run_faculty(url: str) -> FacultyState
        Run the full pipeline for a URL and return the final state.

    faculty_graph
        The compiled StateGraph (use directly for streaming, async, etc.).

State schema
------------
    url            str       provided by caller
    video_id       str       set by ingestion node
    chunks         list      set by ingestion node
    audit_report   dict      set by faculty_audit node — keys:
                               priority_fix, findings, strengths
    status         str       pending | ingested | complete | error
    error          str|None  populated only when status == "error"
"""
from __future__ import annotations

from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from agents.faculty.audit_agent import audit_lecture
from agents.ingestion_agent import ingest_video


class FacultyState(TypedDict, total=False):
    url: str
    video_id: str
    chunks: list[dict[str, Any]]
    audit_report: dict[str, Any]
    status: str
    error: Optional[str]


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


def ingestion_node(state: FacultyState) -> dict[str, Any]:
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
                f"ingestion ({result.get('error_type')}): {result.get('error')}"
            ),
        }

    return {
        "video_id": result["video_id"],
        "chunks": result["chunks"],
        "status": "ingested",
    }


def faculty_audit_node(state: FacultyState) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}

    try:
        result = audit_lecture(state.get("chunks", []))
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": f"audit crashed: {exc}"}

    if not result.get("success"):
        return {
            "status": "error",
            "error": (
                f"audit ({result.get('error_type')}): {result.get('error')}"
            ),
        }

    return {
        "audit_report": {
            "priority_fix": result["priority_fix"],
            "findings": result["findings"],
            "strengths": result["strengths"],
        },
        "status": "complete",
    }


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_graph():
    g = StateGraph(FacultyState)
    g.add_node("ingestion", ingestion_node)
    g.add_node("faculty_audit", faculty_audit_node)

    g.add_edge(START, "ingestion")
    g.add_edge("ingestion", "faculty_audit")
    g.add_edge("faculty_audit", END)

    return g.compile()


faculty_graph = build_graph()


def run_faculty(url: str) -> FacultyState:
    """Run the faculty audit pipeline for ``url`` and return the final state."""
    initial: FacultyState = {
        "url": url,
        "status": "pending",
        "error": None,
    }
    return faculty_graph.invoke(initial)

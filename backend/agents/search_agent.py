"""Search agent.

Uses sentence-transformers (``all-MiniLM-L6-v2``) for local embeddings and
ChromaDB (in-memory) for vector search. No API keys required.

Public API
----------
    index_chunks(video_id, chunks) -> dict
        Embed the chunks and upsert them into a ChromaDB collection named
        after the ``video_id``. Returns a success/error dict matching the
        convention used by the other agents.

    search(video_id, query, top_k=3) -> list[dict]
        Returns the top_k most similar chunks for ``query`` as
        ``[{"text", "start_time", "similarity_score"}, ...]``,
        ordered most-similar-first. Raises ``LookupError`` if the video
        hasn't been indexed yet, or ``ValueError`` if ``query`` is empty.
"""
from __future__ import annotations

from threading import Lock
from typing import Any

import chromadb
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
DEFAULT_TOP_K = 3

# Lazy singletons. The model download (~80 MB) and load happen on first use,
# not at import time, so unrelated tests / scripts don't pay the cost.
_model_lock = Lock()
_model: SentenceTransformer | None = None

_client_lock = Lock()
_client: Any = None  # chromadb client; type kept loose for cross-version compat.


def _get_model() -> SentenceTransformer:
    global _model
    with _model_lock:
        if _model is None:
            _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model


def _get_client() -> Any:
    """Return a process-wide in-memory ChromaDB client."""
    global _client
    with _client_lock:
        if _client is None:
            _client = chromadb.Client()
    return _client


def _collection_name(video_id: str) -> str:
    """Build a ChromaDB-safe collection name from a YouTube video id.

    ChromaDB requires: 3-63 chars, alphanumeric + ``_`` + ``-``, must start
    and end with an alphanumeric character. YouTube ids are 11 chars in
    ``[A-Za-z0-9_-]`` and may start or end with ``_`` or ``-``, so we sandwich
    the id between fixed prefix/suffix to guarantee valid endpoints.
    """
    return f"lecture_{video_id}_chunks"


def _embed(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    vectors = model.encode(texts, show_progress_bar=False)
    return vectors.tolist()


def index_chunks(video_id: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    """Embed the chunks and store them in a ChromaDB collection for this video.

    Possible ``error_type`` values:
        - ``no_video_id``       ``video_id`` is empty
        - ``no_chunks``         ``chunks`` is empty
        - ``embedding_failed``  sentence-transformers blew up
        - ``store_failed``      ChromaDB upsert blew up
    """
    if not video_id:
        return {
            "success": False,
            "error_type": "no_video_id",
            "error": "video_id is empty",
        }
    if not chunks:
        return {
            "success": False,
            "error_type": "no_chunks",
            "error": "No chunks to index.",
        }

    try:
        embeddings = _embed([c["text"] for c in chunks])
    except Exception as exc:  # noqa: BLE001
        return {
            "success": False,
            "error_type": "embedding_failed",
            "error": f"Embedding failed: {exc}",
        }

    name = _collection_name(video_id)
    try:
        client = _get_client()
        # Use cosine space so that distance ∈ [0, 2] and similarity = 1 - distance
        # is in a familiar [-1, 1] range (and ~[0, 1] for typical text).
        collection = client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )
        collection.upsert(
            ids=[str(c["chunk_id"]) for c in chunks],
            embeddings=embeddings,
            documents=[c["text"] for c in chunks],
            metadatas=[
                {
                    "start_time": float(c["start_time"]),
                    "end_time": float(c.get("end_time", c["start_time"])),
                    "chunk_id": str(c["chunk_id"]),
                }
                for c in chunks
            ],
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "success": False,
            "error_type": "store_failed",
            "error": f"ChromaDB upsert failed: {exc}",
        }

    return {
        "success": True,
        "collection": name,
        "indexed": len(chunks),
    }


def search(
    video_id: str,
    query: str,
    top_k: int = DEFAULT_TOP_K,
) -> list[dict[str, Any]]:
    """Return the top_k most similar chunks for ``query``.

    Each hit is ``{"text": str, "start_time": float, "similarity_score": float}``.
    Results are ordered most-similar-first. ``similarity_score`` is
    ``1 - cosine_distance`` and lives in roughly ``[0, 1]`` for related text.

    Raises:
        ValueError: ``query`` is empty or whitespace-only.
        LookupError: no collection exists for this ``video_id`` — call
            ``index_chunks`` first.
    """
    if not query or not query.strip():
        raise ValueError("query is empty")

    client = _get_client()
    name = _collection_name(video_id)
    try:
        collection = client.get_collection(name=name)
    except Exception as exc:
        raise LookupError(
            f"No indexed collection for video_id={video_id!r}. "
            "Call index_chunks() first."
        ) from exc

    query_embedding = _embed([query])[0]
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
    )

    docs = (results.get("documents") or [[]])[0]
    metas = (results.get("metadatas") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]

    hits: list[dict[str, Any]] = []
    for doc, meta, dist in zip(docs, metas, distances):
        meta = meta or {}
        hits.append(
            {
                "text": doc,
                "start_time": float(meta.get("start_time", 0.0)),
                "similarity_score": (
                    1.0 - float(dist) if dist is not None else None
                ),
            }
        )
    return hits

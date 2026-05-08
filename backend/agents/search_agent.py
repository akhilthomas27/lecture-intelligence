"""Search agent.

Uses Google's ``gemini-embedding-001`` model (via ``google-generativeai``) for
embeddings, and ChromaDB (in-memory) for vector search. Requires
``GEMINI_API_KEY`` to be set in the environment.

Why ``gemini-embedding-001`` instead of a local sentence-transformers model:
the Google API saves us the ~700 MB PyTorch dependency and the ~80 MB model
download, at the cost of one network round-trip per embedding batch (and
the same key already used for Gemini chat).

Public API
----------
    index_chunks(video_id, chunks) -> dict
        Embed the chunks (using task_type=RETRIEVAL_DOCUMENT) and upsert
        them into a ChromaDB collection named after the ``video_id``.

    search(video_id, query, top_k=3) -> list[dict]
        Embed the query (using task_type=RETRIEVAL_QUERY) and return the
        top_k most similar chunks as
        ``[{"text", "start_time", "similarity_score"}, ...]``.
"""
from __future__ import annotations

import os
from threading import Lock
from typing import Any

import chromadb
from google import genai

EMBEDDING_MODEL = "gemini-embedding-001"
DEFAULT_TOP_K = 3

# gemini-embedding-001 accepts up to 100 inputs per call; we batch to be safe
# for long lectures while keeping round-trips small.
_EMBED_BATCH_SIZE = 100

# task_type values: tagging documents and queries differently improves
# retrieval quality. See https://ai.google.dev/gemini-api/docs/embeddings
_TASK_DOCUMENT = "RETRIEVAL_DOCUMENT"
_TASK_QUERY = "RETRIEVAL_QUERY"

# google-generativeai requires a single global configure() call per process.
_config_lock = Lock()
_configured = False

# ChromaDB client is also a process-wide singleton.
_client_lock = Lock()
_client: Any = None


def _ensure_configured() -> None:
    global _configured
    with _config_lock:
        if _configured:
            return
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set in the environment")
        genai.configure(api_key=api_key)
        _configured = True


def _get_client() -> Any:
    global _client
    with _client_lock:
        if _client is None:
            _client = chromadb.Client()
    return _client


def _collection_name(video_id: str) -> str:
    """ChromaDB requires names to start/end with alphanumerics; YouTube ids
    can begin or end with ``-``/``_``, so wrap with fixed prefix/suffix."""
    return f"lecture_{video_id}_chunks"


def _embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed many documents using ``RETRIEVAL_DOCUMENT`` task type."""
    _ensure_configured()
    out: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH_SIZE):
        batch = texts[i : i + _EMBED_BATCH_SIZE]
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            content=batch,
            task_type=_TASK_DOCUMENT,
        )
        # When ``content`` is a list, ``embedding`` is a list of lists.
        out.extend(result["embedding"])
    return out


def _embed_query(text: str) -> list[float]:
    """Embed a single query using ``RETRIEVAL_QUERY`` task type."""
    _ensure_configured()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        content=text,
        task_type=_TASK_QUERY,
    )
    # When ``content`` is a single string, ``embedding`` is a flat list.
    return result["embedding"]


def index_chunks(video_id: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    """Embed the chunks and store them in a ChromaDB collection for this video.

    Possible ``error_type`` values:
        - ``no_video_id``       ``video_id`` is empty
        - ``no_chunks``         ``chunks`` is empty
        - ``no_api_key``        ``GEMINI_API_KEY`` is not set in the environment
        - ``embedding_failed``  Gemini embedding call blew up
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
    if not os.getenv("GEMINI_API_KEY"):
        return {
            "success": False,
            "error_type": "no_api_key",
            "error": "GEMINI_API_KEY is not set in the environment.",
        }

    try:
        embeddings = _embed_documents([c["text"] for c in chunks])
    except Exception as exc:  # noqa: BLE001
        return {
            "success": False,
            "error_type": "embedding_failed",
            "error": f"Embedding failed: {exc}",
        }

    name = _collection_name(video_id)
    try:
        client = _get_client()
        # Use cosine space so distance ∈ [0, 2] and similarity = 1 - distance
        # is in a familiar [-1, 1] range (≈[0, 1] for typical text).
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
        LookupError: no collection exists for this ``video_id``.
        RuntimeError: ``GEMINI_API_KEY`` is missing.
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

    query_embedding = _embed_query(query)
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

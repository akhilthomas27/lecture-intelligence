"""Search agent.

Uses Google's ``gemini-embedding-001`` model for embeddings, ChromaDB
(in-memory) for vector search, and Gemini Flash for answer generation.

Public API
----------
    index_chunks(video_id, chunks) -> dict
    search(video_id, query, top_k=3) -> list[dict]
    answer(video_id, query) -> dict
        Returns a study-buddy style answer grounded in the lecture transcript.
        {
            "answer": str,
            "covered": bool,
            "source_timestamp": float | None,
            "source_text": str | None,
            "similarity_score": float | None,
        }
"""
from __future__ import annotations

import os
from threading import Lock
from typing import Any

import chromadb
from google import genai

EMBEDDING_MODEL = "gemini-embedding-001"
ANSWER_MODEL = "gemini-2.5-flash"
DEFAULT_TOP_K = 3
_EMBED_BATCH_SIZE = 100
_TASK_DOCUMENT = "RETRIEVAL_DOCUMENT"
_TASK_QUERY = "RETRIEVAL_QUERY"

# Similarity threshold below which we consider the topic not covered.
# gemini-embedding-001 cosine similarity: 1.0 = identical, 0.0 = unrelated.
# Lectures rarely score below 0.55 on genuinely related questions.
_RELEVANCE_THRESHOLD = 0.55

# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

_genai_lock = Lock()
_genai_client: Any = None

_chroma_lock = Lock()
_chroma_client: Any = None


def _get_genai_client() -> Any:
    global _genai_client
    with _genai_lock:
        if _genai_client is None:
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY is not set in the environment")
            _genai_client = genai.Client(api_key=api_key)
    return _genai_client


def _get_chroma_client() -> Any:
    global _chroma_client
    with _chroma_lock:
        if _chroma_client is None:
            _chroma_client = chromadb.Client()
    return _chroma_client


def _collection_name(video_id: str) -> str:
    return f"lecture_{video_id}_chunks"


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------


def _embed_documents(texts: list[str]) -> list[list[float]]:
    client = _get_genai_client()
    out: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH_SIZE):
        batch = texts[i : i + _EMBED_BATCH_SIZE]
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=batch,
            config={"task_type": _TASK_DOCUMENT},
        )
        out.extend([e.values for e in result.embeddings])
    return out


def _embed_query(text: str) -> list[float]:
    client = _get_genai_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config={"task_type": _TASK_QUERY},
    )
    return result.embeddings[0].values


# ---------------------------------------------------------------------------
# Answer generation
# ---------------------------------------------------------------------------


def _generate_answer(query: str, chunks: list[dict[str, Any]]) -> str:
    """Send the top chunks to Gemini and ask it to answer like a study buddy."""
    client = _get_genai_client()

    # Build context from top chunks with timestamps
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        minutes = int(chunk["start_time"] // 60)
        seconds = int(chunk["start_time"] % 60)
        timestamp = f"{minutes}:{seconds:02d}"
        context_parts.append(
            f"[Chunk {i} — {timestamp}]\n{chunk['text']}"
        )
    context = "\n\n".join(context_parts)

    prompt = f"""You are a knowledgeable and friendly study buddy helping a 
student understand a lecture they are reviewing.

Below are the most relevant excerpts from the lecture transcript, each 
tagged with a timestamp showing where in the lecture it appears.

LECTURE EXCERPTS:
{context}

STUDENT QUESTION:
{query}

Your task:
- Answer the student's question clearly and helpfully based ONLY on 
  what is covered in the lecture excerpts above
- Explain concepts in plain language like a professor or tutor would
- If the excerpts give enough information, give a complete explanation
- Reference the timestamp naturally in your answer 
  e.g. "Around the 5:30 mark, the lecturer explains..."
- If the excerpts are only loosely related and don't really answer 
  the question, say so honestly — don't make things up
- Keep your answer focused and concise — 3 to 5 sentences is ideal
- Do NOT say "based on the excerpts" or "according to the transcript" 
  repeatedly — just explain it naturally as a study buddy would"""

    result = client.models.generate_content(
        model=ANSWER_MODEL,
        contents=prompt,
    )
    return result.text.strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def index_chunks(video_id: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
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
        chroma = _get_chroma_client()
        collection = chroma.get_or_create_collection(
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
    """Original retrieval only — returns raw chunks ranked by similarity.
    Kept for backwards compatibility. Use answer() for study buddy responses.
    """
    if not query or not query.strip():
        raise ValueError("query is empty")

    chroma = _get_chroma_client()
    name = _collection_name(video_id)
    try:
        collection = chroma.get_collection(name=name)
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


def answer(
    video_id: str,
    query: str,
) -> dict[str, Any]:
    """Answer a student question using lecture content as context.

    Returns:
        {
            "answer": str,
            "covered": bool,       True if the topic is in the lecture
            "source_timestamp": float | None,
            "source_text": str | None,
            "similarity_score": float | None,
        }

    The answer field always contains a human readable response:
        - If covered: a study buddy explanation grounded in the lecture
        - If not covered: a friendly message saying it is not in the lecture
    """
    if not query or not query.strip():
        raise ValueError("query is empty")

    # Step 1 — retrieve top matching chunks
    chroma = _get_chroma_client()
    name = _collection_name(video_id)
    try:
        collection = chroma.get_collection(name=name)
    except Exception as exc:
        raise LookupError(
            f"No indexed collection for video_id={video_id!r}. "
            "Call index_chunks() first."
        ) from exc

    query_embedding = _embed_query(query)
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=DEFAULT_TOP_K,
    )

    docs = (results.get("documents") or [[]])[0]
    metas = (results.get("metadatas") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]

    if not docs:
        return {
            "answer": "I couldn't find anything in this lecture related to your question.",
            "covered": False,
            "source_timestamp": None,
            "source_text": None,
            "similarity_score": None,
        }

    # Step 2 — check if best match is relevant enough
    best_score = 1.0 - float(distances[0]) if distances[0] is not None else 0.0

    if best_score < _RELEVANCE_THRESHOLD:
        return {
            "answer": (
                "That topic doesn't appear to be covered in this lecture. "
                "Try asking something more specific to what was discussed, "
                "or jump to a section in the outline above to find what you need."
            ),
            "covered": False,
            "source_timestamp": None,
            "source_text": None,
            "similarity_score": round(best_score, 3),
        }

    # Step 3 — build chunk list with metadata for answer generation
    top_chunks = []
    for doc, meta, dist in zip(docs, metas, distances):
        meta = meta or {}
        top_chunks.append(
            {
                "text": doc,
                "start_time": float(meta.get("start_time", 0.0)),
                "similarity_score": 1.0 - float(dist) if dist is not None else None,
            }
        )

    # Step 4 — generate study buddy answer
    try:
        generated_answer = _generate_answer(query, top_chunks)
    except Exception as exc:  # noqa: BLE001
        # Fall back to showing the raw transcript chunk if Gemini fails
        generated_answer = top_chunks[0]["text"]

    return {
        "answer": generated_answer,
        "covered": True,
        "source_timestamp": top_chunks[0]["start_time"],
        "source_text": top_chunks[0]["text"],
        "similarity_score": round(best_score, 3),
    }
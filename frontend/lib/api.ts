// ---- Types -----------------------------------------------------------------

export type Status =
  | "pending"
  | "ingested"
  | "curated"
  | "complete"
  | "error";

export interface JobStatus {
  job_id: string;
  status: Status;
  video_id: string | null;
  embeddings_ready: boolean;
  error: string | null;
}

export interface OutlineSection {
  title: string;
  level: number;
  start_time: number;
  summary: string;
}

export interface Flashcard {
  question: string;
  answer: string;
  source_timestamp: number;
  source_text: string;
}

export interface Chunk {
  chunk_id: string;
  text: string;
  start_time: number;
  end_time: number;
}

export interface Summaries {
  summary_90s: string;
  summary_5min: string;
  full_summary: string;
}

export interface LectureResult {
  video_id: string;
  url: string;
  chunks: Chunk[];
  outline: OutlineSection[];
  summaries: Summaries;
  flashcards: Flashcard[];
  embeddings_ready: boolean;
  status: Status;
  error: string | null;
}

export interface ResultsResponse {
  job_id: string;
  status: Status;
  result: LectureResult;
}

export interface SearchHit {
  text: string;
  start_time: number;
  similarity_score: number;
}

export interface SearchResponse {
  job_id: string;
  query: string;
  result: SearchHit | null;
}

export interface TranslationResponse {
  job_id: string;
  target_language: string;
  outline: OutlineSection[];
  summaries: Summaries;
  flashcards: Flashcard[];
}

/** The translatable subset that the dashboard re-renders against. */
export interface StudyMaterials {
  outline: OutlineSection[];
  summaries: Summaries;
  flashcards: Flashcard[];
}

// ---- Internal helpers ------------------------------------------------------

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `${res.status} ${res.statusText}`;
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === "string") message = detail;
    else if (detail?.error) message = String(detail.error);
    else if (detail?.message) message = String(detail.message);
    else if (Array.isArray(detail) && detail[0]?.msg) message = String(detail[0].msg);
    // slowapi 429 default response shape: {"error": "Rate limit exceeded: ..."}
    else if (typeof data?.error === "string") message = data.error;
  } catch {
    /* leave default message */
  }
  throw new Error(message);
}

// ---- Endpoints -------------------------------------------------------------

export async function submitLecture(
  url: string,
): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return (await ensureOk(res)).json();
}

export async function getStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/status/${jobId}`,
    {
      cache: "no-store",
    },
  );
  return (await ensureOk(res)).json();
}

export async function getResults(jobId: string): Promise<ResultsResponse> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/results/${jobId}`,
    {
      cache: "no-store",
    },
  );
  return (await ensureOk(res)).json();
}

export async function searchLecture(
  jobId: string,
  query: string,
): Promise<SearchResponse> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, query }),
  });
  return (await ensureOk(res)).json();
}

export async function translateMaterials(
  jobId: string,
  targetLanguage: string,
): Promise<TranslationResponse> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, target_language: targetLanguage }),
  });
  return (await ensureOk(res)).json();
}

// ---- Display helpers -------------------------------------------------------

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

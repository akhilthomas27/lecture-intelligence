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

export interface AnswerResponse {
  job_id: string;
  query: string;
  answer: string;
  covered: boolean;
  source_timestamp: number | null;
  source_text: string | null;
  similarity_score: number | null;
}

// ---- Faculty audit ---------------------------------------------------------

export type AuditDimension =
  | "pedagogical"
  | "accessibility"
  | "equity"
  | "language";

export type AuditSeverity = "high" | "medium" | "low";

export interface PriorityFix {
  title: string;
  issue: string;
  why_it_matters: string;
  timestamp: number;
  original_text: string;
  suggested_rewrite: string;
}

export interface AuditFinding {
  dimension: AuditDimension;
  title: string;
  issue: string;
  severity: AuditSeverity;
  timestamp: number;
  original_text: string;
  suggested_rewrite: string;
}

export interface AuditStrength {
  title: string;
  description: string;
  timestamp: number;
}

export interface AuditReport {
  priority_fix: PriorityFix;
  findings: AuditFinding[];
  strengths: AuditStrength[];
}

export interface FacultyReportResponse {
  job_id: string;
  video_id: string | null;
  url: string;
  audit_report: AuditReport;
}

// ---- Provost coverage map --------------------------------------------------

export type ObjectiveStatus =
  | "fully_covered"
  | "partially_covered"
  | "not_covered";

export interface CurriculumSummary {
  total_objectives: number;
  fully_covered: number;
  partially_covered: number;
  not_covered: number;
  coverage_percentage: number;
}

export interface ObjectiveLectureRef {
  url: string;
  timestamp: number;
  excerpt: string;
}

export interface CurriculumObjective {
  objective: string;
  status: ObjectiveStatus;
  coverage_detail: string;
  lectures: ObjectiveLectureRef[];
}

export interface CurriculumLecture {
  url: string;
  objectives_covered: number;
  key_topics: string[];
  gaps: string[];
}

export interface CurriculumRecommendation {
  priority: number;
  gap: string;
  suggestion: string;
}

export interface CurriculumMap {
  summary: CurriculumSummary;
  objectives: CurriculumObjective[];
  lectures: CurriculumLecture[];
  recommendations: CurriculumRecommendation[];
}

export interface FailedLecture {
  url: string;
  error_type: string | null;
  error: string | null;
}

export interface ProvostReportResponse {
  job_id: string;
  urls: string[];
  objectives: string;
  failed_lectures: FailedLecture[];
  curriculum_map: CurriculumMap;
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

export async function answerLecture(
  jobId: string,
  query: string,
): Promise<AnswerResponse> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, query }),
  });
  return (await ensureOk(res)).json();
}

// ---- Faculty / Provost endpoints ------------------------------------------

export async function submitFacultyLecture(
  url: string,
): Promise<{ job_id: string; status: string; user_type?: string }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, user_type: "faculty" }),
  });
  return (await ensureOk(res)).json();
}

export async function submitProvostCourse(
  urls: string[],
  objectives: string,
): Promise<{ job_id: string; status: string; user_type?: string }> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/process-course`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, objectives }),
    },
  );
  return (await ensureOk(res)).json();
}

export async function getFacultyReport(
  jobId: string,
): Promise<FacultyReportResponse> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/faculty-report/${jobId}`,
    { cache: "no-store" },
  );
  return (await ensureOk(res)).json();
}

export async function getProvostReport(
  jobId: string,
): Promise<ProvostReportResponse> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/provost-report/${jobId}`,
    { cache: "no-store" },
  );
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


export interface PlaylistVideo {
  url: string;
  title: string;
}

export interface PlaylistValidationResponse {
  success: boolean;
  video_count: number;
  videos: PlaylistVideo[];
}

export async function validatePlaylist(
  playlistUrl: string,
): Promise<PlaylistValidationResponse> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/validate-playlist?url=${encodeURIComponent(playlistUrl)}`,
    { cache: "no-store" },
  );
  return (await ensureOk(res)).json();
}
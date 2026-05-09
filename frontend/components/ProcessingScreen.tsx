"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getStatus, type JobStatus, type Status } from "@/lib/api";

export type ProcessingType = "student" | "faculty" | "provost";

type StageState = "pending" | "active" | "done" | "error";

const POLL_MS = 2000;

// ---------------------------------------------------------------------------
// Per-role configuration
// ---------------------------------------------------------------------------

interface RoleConfig {
  stages: string[];
  // Map an active backend status → "stages done so far". Anything past the
  // last entry counts as fully complete.
  stagesDoneByStatus: Partial<Record<Status, number>>;
  activeMessage: Partial<Record<Status, string>>;
  destination: (jobId: string) => string;
  cardTitle: string;
  successMessage: string;
}

const STUDENT_CONFIG: RoleConfig = {
  stages: [
    "Fetching transcript",
    "Analyzing structure",
    "Generating flashcards",
    "Building search index",
  ],
  // Student backend emits: pending → ingested → curated → complete.
  // Map curated → 3 stages done so the 4-label UI feels honest even
  // though "Analyzing structure" and "Generating flashcards" share
  // a single Gemini call.
  stagesDoneByStatus: {
    pending: 0,
    ingested: 1,
    curated: 3,
    complete: 4,
  },
  activeMessage: {
    pending: "Fetching the transcript from YouTube…",
    ingested: "Calling Gemini to draft your outline, summaries, and flashcards…",
    curated: "Embedding chunks and building the search index…",
    complete: "All done!",
  },
  destination: (jobId) => `/study/${jobId}`,
  cardTitle: "Processing your lecture",
  successMessage: "Your study workspace is ready.",
};

const FACULTY_CONFIG: RoleConfig = {
  stages: [
    "Fetching transcript",
    "Analyzing pedagogy",
    "Evaluating accessibility",
    "Generating audit report",
  ],
  // Faculty backend emits: pending → ingested → complete.
  // The audit is one Gemini call covering pedagogy + accessibility +
  // equity + tone, so the middle stages share the "ingested" state.
  stagesDoneByStatus: {
    pending: 0,
    ingested: 1,
    complete: 4,
  },
  activeMessage: {
    pending: "Fetching the transcript from YouTube…",
    ingested:
      "Auditing pedagogical clarity, accessibility, equity & tone with Gemini…",
    complete: "Audit ready.",
  },
  destination: (jobId) => `/faculty/report/${jobId}`,
  cardTitle: "Auditing your lecture",
  successMessage: "Your private audit report is ready.",
};

const PROVOST_CONFIG: RoleConfig = {
  stages: [
    "Fetching transcripts",
    "Mapping curriculum",
    "Comparing learning objectives",
    "Building coverage report",
  ],
  // Provost backend emits: pending → ingested → complete.
  stagesDoneByStatus: {
    pending: 0,
    ingested: 1,
    complete: 4,
  },
  activeMessage: {
    pending: "Pulling transcripts for every lecture you submitted…",
    ingested:
      "Comparing each lecture against your stated objectives with Gemini…",
    complete: "Coverage map ready.",
  },
  destination: (jobId) => `/provost/report/${jobId}`,
  cardTitle: "Building your coverage map",
  successMessage: "Your curriculum coverage map is ready.",
};

const CONFIG_BY_TYPE: Record<ProcessingType, RoleConfig> = {
  student: STUDENT_CONFIG,
  faculty: FACULTY_CONFIG,
  provost: PROVOST_CONFIG,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  jobId: string;
  type: ProcessingType;
}

export default function ProcessingScreen({ jobId, type }: Props) {
  const config = CONFIG_BY_TYPE[type];
  const router = useRouter();
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const data = await getStatus(jobId);
        if (cancelledRef.current) return;
        setJob(data);
        if (data.status === "complete") {
          router.replace(config.destination(jobId));
          return;
        }
        if (data.status === "error") {
          setError(data.error ?? "Pipeline failed");
          return;
        }
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : "Polling failed");
        }
        return;
      }
      if (!cancelledRef.current) {
        timer = setTimeout(tick, POLL_MS);
      }
    }

    tick();
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, router, config]);

  const status: Status = job?.status ?? "pending";
  const hasError = !!error;

  const stagesDone = hasError
    ? 0
    : config.stagesDoneByStatus[status] ?? 0;

  const messageKey = hasError ? "error" : status;
  const activeMessage = hasError
    ? error
    : config.activeMessage[status] ??
      config.activeMessage.pending ??
      "Working…";

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-8"
      >
        <h2 className="text-xl font-semibold text-center text-slate-300 mb-1">
          {hasError ? "Something went wrong" : config.cardTitle}
        </h2>

        <div className="min-h-[3.5rem] flex items-center justify-center mb-8">
          <AnimatePresence mode="wait">
            <motion.p
              key={messageKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`text-center text-sm leading-relaxed ${
                hasError ? "text-rose-300" : "text-slate-400"
              }`}
            >
              {activeMessage}
            </motion.p>
          </AnimatePresence>
        </div>

        <ul className="space-y-4">
          {config.stages.map((label, idx) => {
            const state: StageState = hasError
              ? "pending"
              : idx < stagesDone
              ? "done"
              : idx === stagesDone
              ? "active"
              : "pending";
            return (
              <li key={label} className="flex items-center gap-3">
                <StageIcon state={state} />
                <motion.span
                  animate={{
                    color:
                      state === "done"
                        ? "#e2e8f0"
                        : state === "active"
                        ? "#f1f5f9"
                        : "#64748b",
                  }}
                  transition={{ duration: 0.3 }}
                  className="text-sm"
                >
                  {label}
                </motion.span>
              </li>
            );
          })}
        </ul>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6"
            >
              <Link
                href="/"
                className="inline-block text-sm text-indigo-400 hover:text-indigo-300"
              >
                ← Back to start
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-8 text-xs text-slate-600 font-mono text-center break-all">
          job: {jobId}
        </p>
      </motion.div>
    </main>
  );
}

// ----- Stage icon -----------------------------------------------------------

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") {
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-slate-950 shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
    );
  }
  if (state === "active") {
    return (
      <div className="relative w-6 h-6 shrink-0">
        <motion.div
          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-full bg-indigo-500/40"
        />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-full border-2 border-slate-700 border-t-indigo-400"
        />
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="w-6 h-6 rounded-full bg-rose-500/20 border border-rose-500 flex items-center justify-center shrink-0">
        <span className="text-rose-400 text-xs leading-none">!</span>
      </div>
    );
  }
  return <div className="w-6 h-6 rounded-full border-2 border-slate-800 shrink-0" />;
}

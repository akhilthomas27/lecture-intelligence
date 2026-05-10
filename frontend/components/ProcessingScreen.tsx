"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getStatus, type JobStatus, type Status } from "@/lib/api";

export type ProcessingType = "student" | "faculty" | "provost";

const POLL_MS = 2000;

// Estimated seconds for the "fake" progress to climb 0→95.
// We never reach 100 until the backend says so.
const PROGRESS_TARGET = 95;
const PROGRESS_DURATION_S = 90;

// ---------------------------------------------------------------------------
// Per-role configuration (logic preserved from previous version)
// ---------------------------------------------------------------------------

interface RoleConfig {
  stages: string[];
  stagesDoneByStatus: Partial<Record<Status, number>>;
  destination: (jobId: string) => string;
  cardTitle: string;
}

const STUDENT_CONFIG: RoleConfig = {
  stages: [
    "Fetching transcript",
    "Analyzing structure",
    "Generating flashcards",
    "Building search index",
  ],
  stagesDoneByStatus: {
    pending: 0,
    ingested: 1,
    curated: 3,
    complete: 4,
  },
  destination: (jobId) => `/study/${jobId}`,
  cardTitle: "Processing your lecture",
};

const FACULTY_CONFIG: RoleConfig = {
  stages: [
    "Fetching transcript",
    "Analyzing pedagogy",
    "Evaluating accessibility",
    "Generating audit report",
  ],
  stagesDoneByStatus: {
    pending: 0,
    ingested: 1,
    complete: 4,
  },
  destination: (jobId) => `/faculty/report/${jobId}`,
  cardTitle: "Auditing your lecture",
};

const PROVOST_CONFIG: RoleConfig = {
  stages: [
    "Fetching transcripts",
    "Mapping curriculum",
    "Comparing learning objectives",
    "Building coverage report",
  ],
  stagesDoneByStatus: {
    pending: 0,
    ingested: 1,
    complete: 4,
  },
  destination: (jobId) => `/provost/report/${jobId}`,
  cardTitle: "Building your coverage map",
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

  // Progress bar state. We start at 0, push to PROGRESS_TARGET on mount, and
  // snap to 100 only when the backend confirms completion.
  const [progress, setProgress] = useState(0);
  const [progressTransitionMs, setProgressTransitionMs] = useState(
    PROGRESS_DURATION_S * 1000,
  );

  useEffect(() => {
    // Kick off the slow climb after one tick so the CSS transition fires.
    const id = window.setTimeout(() => setProgress(PROGRESS_TARGET), 50);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const data = await getStatus(jobId);
        if (cancelledRef.current) return;
        setJob(data);
        if (data.status === "complete") {
          // Quickly fill the remaining 5% then redirect.
          setProgressTransitionMs(400);
          setProgress(100);
          window.setTimeout(() => {
            if (!cancelledRef.current) router.replace(config.destination(jobId));
          }, 450);
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

  const stagesDone = hasError ? 0 : config.stagesDoneByStatus[status] ?? 0;
  // Active stage label = the one currently running (the first not-yet-done).
  // Clamp at the last label when everything is done.
  const activeStageLabel =
    stagesDone < config.stages.length
      ? config.stages[stagesDone]
      : config.stages[config.stages.length - 1];

  const headlineKey = hasError ? "error" : `${status}-${activeStageLabel}`;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="glass-card w-full max-w-md p-8 sm:p-12"
      >
        {/* ---- Spinner (CSS-only, no library) -------------------------- */}
        <div className="flex justify-center mb-8">
          <div
            className="w-12 h-12 rounded-full border-2 animate-spin"
            style={{
              borderColor: "rgba(255,255,255,0.10)",
              borderTopColor: "#6366f1",
              animationDuration: "1s",
            }}
            aria-hidden
          />
        </div>

        {/* ---- Card title ---------------------------------------------- */}
        <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-indigo-400 text-center mb-2">
          {hasError ? "Error" : config.cardTitle}
        </p>

        {/* ---- Large animated status (slide up out / slide up in) ------- */}
        <div className="min-h-[2.75rem] sm:min-h-[3rem] flex items-center justify-center mb-6 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.h2
              key={headlineKey}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`text-xl sm:text-2xl font-semibold text-center ${
                hasError ? "text-rose-300" : "text-white"
              }`}
            >
              {hasError ? "Something went wrong" : `${activeStageLabel}…`}
            </motion.h2>
          </AnimatePresence>
        </div>

        {/* ---- Progress bar ------------------------------------------- */}
        <div
          className="h-[3px] w-full rounded-full overflow-hidden mb-3"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <div
            className="h-full"
            style={{
              width: `${hasError ? 0 : progress}%`,
              background: hasError ? "#f43f5e" : "#6366f1",
              transition: `width ${progressTransitionMs}ms linear`,
              boxShadow: hasError
                ? "none"
                : "0 0 12px rgba(99,102,241,0.6)",
            }}
          />
        </div>

        {/* ---- Helper text -------------------------------------------- */}
        <p className="text-[11px] sm:text-xs text-white/40 text-center">
          {hasError
            ? "The pipeline couldn't finish — see the error below."
            : "This usually takes 60–90 seconds for a typical lecture."}
        </p>

        {/* ---- Pulsing dots ------------------------------------------- */}
        {!hasError && (
          <div className="flex items-center justify-center gap-1.5 mt-6">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.18,
                }}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "#ffffff" }}
              />
            ))}
          </div>
        )}

        {/* ---- Error block + back link -------------------------------- */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6"
            >
              <p
                className="p-3 rounded-lg text-rose-300 text-sm leading-relaxed"
                style={{
                  background: "rgba(244,63,94,0.08)",
                  border: "1px solid rgba(244,63,94,0.25)",
                }}
              >
                {error}
              </p>
              <Link
                href="/"
                className="mt-4 inline-block text-sm text-indigo-300 hover:text-indigo-200 transition-colors"
              >
                ← Back to start
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-8 text-[10px] text-white/25 font-mono text-center break-all">
          job: {jobId}
        </p>
      </motion.div>
    </main>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getStatus, type JobStatus, type Status } from "@/lib/api";

type StageState = "pending" | "active" | "done" | "error";

const STAGES = [
  { key: "ingestion", label: "Fetching transcript & chunking" },
  { key: "curriculum", label: "Generating study materials" },
  { key: "search", label: "Building search index" },
] as const;

const STATUS_ORDER: Status[] = ["pending", "ingested", "curated", "complete"];

// Larger, friendlier message shown while a stage is running.
const ACTIVE_MESSAGE: Record<Status, string> = {
  pending: "Fetching the transcript from YouTube…",
  ingested: "Calling Gemini to draft your outline, summaries, and flashcards…",
  curated: "Embedding chunks and building the search index…",
  complete: "All done!",
  error: "Something went wrong.",
};

const POLL_MS = 2000;

function stageState(stageKey: string, status: Status, hasError: boolean): StageState {
  if (hasError) return "pending";
  const cur = STATUS_ORDER.indexOf(status);
  if (cur === -1) return "pending";
  if (stageKey === "ingestion") {
    if (cur >= 1) return "done";
    return cur === 0 ? "active" : "pending";
  }
  if (stageKey === "curriculum") {
    if (cur >= 2) return "done";
    return cur === 1 ? "active" : "pending";
  }
  // search
  if (cur >= 3) return "done";
  return cur === 2 ? "active" : "pending";
}

export default function ProcessingScreen({ jobId }: { jobId: string }) {
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
          router.replace(`/study/${jobId}`);
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
  }, [jobId, router]);

  const status: Status = job?.status ?? "pending";
  const hasError = !!error;
  // Stable key for AnimatePresence — when this changes, the message crossfades.
  const messageKey = hasError ? "error" : status;
  const activeMessage = hasError
    ? error
    : ACTIVE_MESSAGE[status] ?? ACTIVE_MESSAGE.pending;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-8"
      >
        <h2 className="text-xl font-semibold text-center text-slate-300 mb-1">
          {hasError ? "Something went wrong" : "Processing your lecture"}
        </h2>

        {/* Animated current-status message — crossfades when stage advances. */}
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
          {STAGES.map((stage) => {
            const s = stageState(stage.key, status, hasError);
            return (
              <li key={stage.key} className="flex items-center gap-3">
                <StageIcon state={s} />
                <motion.span
                  animate={{
                    color:
                      s === "done"
                        ? "#e2e8f0"
                        : s === "active"
                        ? "#f1f5f9"
                        : "#64748b",
                  }}
                  transition={{ duration: 0.3 }}
                  className="text-sm"
                >
                  {stage.label}
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
                ← Try another URL
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
        {/* Pulsing halo */}
        <motion.div
          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-full bg-indigo-500/40"
        />
        {/* Spinner */}
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

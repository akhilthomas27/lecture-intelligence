"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatTime,
  getProvostReport,
  type CurriculumLecture,
  type CurriculumObjective,
  type CurriculumRecommendation,
  type FailedLecture,
  type ObjectiveStatus,
  type ProvostReportResponse,
} from "@/lib/api";
import RoleHeader from "@/components/RoleHeader";

const STATUS_META: Record<
  ObjectiveStatus,
  { label: string; tone: string; bar: string }
> = {
  fully_covered: {
    label: "Fully Covered",
    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    bar: "bg-emerald-500",
  },
  partially_covered: {
    label: "Partially Covered",
    tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    bar: "bg-amber-500",
  },
  not_covered: {
    label: "Not Covered",
    tone: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    bar: "bg-rose-500",
  },
};

export default function ProvostReport({ jobId }: { jobId: string }) {
  const [data, setData] = useState<ProvostReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProvostReport(jobId)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load report"),
      );
  }, [jobId]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <p className="text-rose-400 mb-4">Error: {error}</p>
          <Link
            href="/provost"
            className="text-indigo-400 hover:text-indigo-300"
          >
            ← Build another coverage map
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </main>
    );
  }

  const { summary, objectives, lectures, recommendations } = data.curriculum_map;

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen p-3 sm:p-4 md:p-6"
    >
      <RoleHeader />

      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Curriculum Coverage Map
          </h1>
          <p className="text-sm text-slate-500">
            {summary.total_objectives} objective
            {summary.total_objectives === 1 ? "" : "s"} · {lectures.length}{" "}
            lecture{lectures.length === 1 ? "" : "s"} analysed
          </p>
        </header>

        <CoverageSummaryBar
          summary={summary}
          totalLectures={lectures.length}
        />

        {data.failed_lectures.length > 0 && (
          <FailedLectureBanner failed={data.failed_lectures} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: objectives list */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Objectives Coverage</h2>
            <ul className="space-y-3">
              {objectives.map((o, i) => (
                <ObjectiveCard key={i} objective={o} />
              ))}
            </ul>
          </section>

          {/* Right: lecture breakdown */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Lecture Breakdown</h2>
            <ul className="space-y-3">
              {lectures.map((lec, i) => (
                <LectureCard key={i} lecture={lec} />
              ))}
            </ul>
          </section>
        </div>

        {recommendations.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Recommendations</h2>
            <ul className="space-y-3">
              {[...recommendations]
                .sort((a, b) => a.priority - b.priority)
                .map((r, i) => (
                  <RecommendationCard key={i} recommendation={r} />
                ))}
            </ul>
          </section>
        )}
      </div>
    </motion.main>
  );
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function CoverageSummaryBar({
  summary,
  totalLectures,
}: {
  summary: ProvostReportResponse["curriculum_map"]["summary"];
  totalLectures: number;
}) {
  const total = Math.max(1, summary.total_objectives);
  const fullyPct = (summary.fully_covered / total) * 100;
  const partialPct = (summary.partially_covered / total) * 100;
  const notPct = (summary.not_covered / total) * 100;

  return (
    <section className="p-5 sm:p-6 rounded-xl border border-slate-800 bg-slate-900/40 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Coverage
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-slate-100">
            {summary.fully_covered + summary.partially_covered} of{" "}
            {summary.total_objectives}
            <span className="text-base font-normal text-slate-500 ml-2">
              objectives covered
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Score
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-indigo-300">
            {summary.coverage_percentage.toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="h-3 rounded-full bg-slate-800 overflow-hidden flex">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${fullyPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full bg-emerald-500"
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${partialPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          className="h-full bg-amber-500"
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${notPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
          className="h-full bg-rose-500"
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <LegendDot color="bg-emerald-500" label={`${summary.fully_covered} fully`} />
        <LegendDot color="bg-amber-500" label={`${summary.partially_covered} partially`} />
        <LegendDot color="bg-rose-500" label={`${summary.not_covered} not covered`} />
        <span className="ml-auto">
          {totalLectures} lecture{totalLectures === 1 ? "" : "s"}
        </span>
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Failed-ingestion banner
// ---------------------------------------------------------------------------

function FailedLectureBanner({ failed }: { failed: FailedLecture[] }) {
  return (
    <section className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <p className="text-sm font-semibold text-amber-300 mb-2">
        {failed.length} lecture{failed.length === 1 ? "" : "s"} couldn&apos;t be transcribed
      </p>
      <p className="text-xs text-amber-200/80 mb-2 leading-relaxed">
        These were skipped — the coverage map below reflects only the lectures we could read.
      </p>
      <ul className="space-y-1 text-xs text-amber-200/70 font-mono">
        {failed.map((f, i) => (
          <li key={i} className="break-all">
            • {f.url} <span className="text-amber-200/40">— {f.error_type}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Objective card
// ---------------------------------------------------------------------------

function ObjectiveCard({ objective }: { objective: CurriculumObjective }) {
  const meta = STATUS_META[objective.status];
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-lg border border-slate-800 bg-slate-900/40 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-100 leading-snug">{objective.objective}</p>
        <span
          className={`shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.tone}`}
        >
          {meta.label}
        </span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        {objective.coverage_detail}
      </p>
      {objective.lectures.length > 0 && (
        <ul className="space-y-2 pt-2 border-t border-slate-800">
          {objective.lectures.map((ref, i) => (
            <li key={i} className="text-xs text-slate-400">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 truncate font-mono text-[11px]"
                >
                  {ref.url}
                </a>
                <a
                  href={`${ref.url}${ref.url.includes("?") ? "&" : "?"}t=${Math.floor(ref.timestamp)}s`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 font-mono text-[11px] shrink-0"
                >
                  {formatTime(ref.timestamp)}
                </a>
              </div>
              <blockquote className="italic text-slate-500 leading-relaxed border-l-2 border-slate-800 pl-2">
                &ldquo;{ref.excerpt}&rdquo;
              </blockquote>
            </li>
          ))}
        </ul>
      )}
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Lecture card
// ---------------------------------------------------------------------------

function LectureCard({ lecture }: { lecture: CurriculumLecture }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-lg border border-slate-800 bg-slate-900/40 space-y-3"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <a
          href={lecture.url}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-400 hover:text-indigo-300 truncate font-mono text-[11px] sm:text-xs"
        >
          {lecture.url}
        </a>
        <span className="text-xs text-slate-500 shrink-0">
          {lecture.objectives_covered} objective
          {lecture.objectives_covered === 1 ? "" : "s"} covered
        </span>
      </div>

      {lecture.key_topics.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
            Key topics
          </p>
          <div className="flex flex-wrap gap-1.5">
            {lecture.key_topics.map((t, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {lecture.gaps.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
            Gaps
          </p>
          <ul className="space-y-1 text-xs text-slate-400 list-disc list-inside leading-relaxed">
            {lecture.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Recommendation card
// ---------------------------------------------------------------------------

function RecommendationCard({
  recommendation,
}: {
  recommendation: CurriculumRecommendation;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="p-4 rounded-lg border border-slate-800 bg-slate-900/40 flex gap-3"
    >
      <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-sm font-semibold flex items-center justify-center">
        {recommendation.priority}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-100">
          {recommendation.gap}
        </p>
        <p className="text-sm text-slate-300 leading-relaxed">
          {recommendation.suggestion}
        </p>
      </div>
    </motion.li>
  );
}

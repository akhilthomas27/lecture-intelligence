"use client";

import { AnimatePresence, motion } from "framer-motion";
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
import SwitchRoleButton from "@/components/SwitchRoleButton";
import Image from "next/image";

// ---------------------------------------------------------------------------
// Per-status accent palette
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  ObjectiveStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  fully_covered: {
    label: "Fully Covered",
    color: "#10b981",
    bg: "rgba(16,185,129,0.10)",
    border: "rgba(16,185,129,0.30)",
  },
  partially_covered: {
    label: "Partially Covered",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.30)",
  },
  not_covered: {
    label: "Not Covered",
    color: "#f43f5e",
    bg: "rgba(244,63,94,0.10)",
    border: "rgba(244,63,94,0.30)",
  },
};

// ---------------------------------------------------------------------------

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
        <div className="text-center max-w-md glass-card p-8">
          <p className="text-rose-300 mb-4 text-sm">Error: {error}</p>
          <Link
            href="/provost"
            className="text-indigo-300 hover:text-indigo-200"
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
        <p className="text-white/50">Loading…</p>
      </main>
    );
  }

  const { summary, objectives, lectures, recommendations } =
    data.curriculum_map;

  return (
    <main className="min-h-screen flex flex-col">
      <ProvostTopNav />

      <div className="flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 max-w-7xl mx-auto w-full">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
            Curriculum Coverage Map
          </h1>
          <p className="text-sm text-white/45">
            {summary.total_objectives} objective
            {summary.total_objectives === 1 ? "" : "s"} · {lectures.length}{" "}
            lecture{lectures.length === 1 ? "" : "s"} analysed
          </p>
        </header>

        <CoverageBanner
          summary={summary}
          totalLectures={lectures.length}
        />

        {data.failed_lectures.length > 0 && (
          <FailedLectureBanner failed={data.failed_lectures} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 mt-6">
          <section>
            <SectionHeading>Objectives Coverage</SectionHeading>
            <ul className="space-y-3">
              {objectives.map((o, i) => (
                <ObjectiveCard key={i} objective={o} />
              ))}
            </ul>
          </section>

          <section>
            <SectionHeading>Lecture Breakdown</SectionHeading>
            <ul className="space-y-3">
              {lectures.map((lec, i) => (
                <LectureCard key={i} lecture={lec} />
              ))}
            </ul>
          </section>
        </div>

        {recommendations.length > 0 && (
          <section className="mt-8">
            <SectionHeading>Recommendations</SectionHeading>
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
    </main>
  );
}

// ---------------------------------------------------------------------------
// Top nav
// ---------------------------------------------------------------------------

function ProvostTopNav() {
  return (
    <header
      className="top-nav flex items-center gap-3 px-4 sm:px-6 h-14 shrink-0"
      style={{ backgroundColor: "rgba(37, 35, 36, 1)" }}
    >
      <Link href="/" className="flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Lecture Intelligence"
          width={100}
          height={100}
          style={{ objectFit: "contain", borderRadius: 1 }}
          priority
        />
      </Link>
      <div className="flex-1" />
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <SwitchRoleButton />
      </div>
    </header>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs uppercase tracking-[0.22em] text-white/45 mb-3">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Coverage summary banner
// ---------------------------------------------------------------------------

function CoverageBanner({
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
  const covered = summary.fully_covered + summary.partially_covered;

  return (
    <section className="glass-card p-5 sm:p-6 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-1">
            Coverage
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-white">
            {covered} of {summary.total_objectives}
            <span className="text-sm sm:text-base font-normal text-white/50 ml-2">
              objectives covered
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-1">
            Score
          </p>
          <p
            className="text-2xl sm:text-3xl font-bold"
            style={{ color: "#a5b4fc" }}
          >
            {summary.coverage_percentage.toFixed(0)}%
          </p>
        </div>
      </div>

      <div
        className="h-3 rounded-full overflow-hidden flex"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${fullyPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full"
          style={{ background: "#10b981" }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${partialPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          className="h-full"
          style={{ background: "#f59e0b" }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${notPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
          className="h-full"
          style={{ background: "#f43f5e" }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <StatPill
          color="#10b981"
          label={`${summary.fully_covered} Fully Covered`}
        />
        <StatPill
          color="#f59e0b"
          label={`${summary.partially_covered} Partially Covered`}
        />
        <StatPill
          color="#f43f5e"
          label={`${summary.not_covered} Not Covered`}
        />
        <span className="ml-auto text-xs text-white/40 self-center">
          {totalLectures} lecture{totalLectures === 1 ? "" : "s"}
        </span>
      </div>
    </section>
  );
}

function StatPill({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full"
      style={{
        background: `${color}14`,
        border: `1px solid ${color}40`,
        color: `${color}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      <span style={{ color: "rgba(255,255,255,0.85)" }}>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Failed-ingestion banner
// ---------------------------------------------------------------------------

function FailedLectureBanner({ failed }: { failed: FailedLecture[] }) {
  return (
    <section
      className="mt-4 p-4 rounded-2xl"
      style={{
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.30)",
      }}
    >
      <p className="text-sm font-semibold text-amber-300 mb-1">
        {failed.length} lecture{failed.length === 1 ? "" : "s"} couldn&apos;t
        be transcribed
      </p>
      <p className="text-xs text-amber-200/70 mb-2 leading-relaxed">
        These were skipped — the coverage map below reflects only the lectures
        we could read.
      </p>
      <ul className="space-y-1 text-xs text-amber-200/60 font-mono">
        {failed.map((f, i) => (
          <li key={i} className="break-all">
            • {f.url}{" "}
            <span className="text-amber-200/40">— {f.error_type}</span>
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
  const [open, setOpen] = useState(false);
  const hasRefs = objective.lectures.length > 0;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 sm:p-5 space-y-3"
      style={{
        background: "rgba(37, 35, 36, 1)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: `3px solid ${meta.color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm sm:text-[15px] text-white leading-snug">
          {objective.objective}
        </p>
        <span
          className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{
            background: meta.bg,
            border: `1px solid ${meta.border}`,
            color: meta.color,
          }}
        >
          {meta.label}
        </span>
      </div>
      <p className="text-xs sm:text-sm text-white/55 leading-relaxed">
        {objective.coverage_detail}
      </p>
      {hasRefs && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-[11px] text-white/45 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
              aria-hidden
            >
              <path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {open ? "Hide lecture references" : "View lecture references"}
            <span className="text-white/30">
              ({objective.lectures.length})
            </span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul
                key="refs"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden space-y-2 mt-3 pt-3"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                {objective.lectures.map((ref, i) => (
                  <li key={i} className="text-xs text-white/55">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-300 hover:text-indigo-200 truncate font-mono text-[10px]"
                      >
                        {ref.url}
                      </a>
                      <a
                        href={`${ref.url}${
                          ref.url.includes("?") ? "&" : "?"
                        }t=${Math.floor(ref.timestamp)}s`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-300 hover:text-indigo-200 font-mono text-[10px] shrink-0"
                      >
                        {formatTime(ref.timestamp)}
                      </a>
                    </div>
                    <blockquote
                      className="italic text-white/40 leading-relaxed pl-2"
                      style={{ borderLeft: "2px solid rgba(255,255,255,0.10)" }}
                    >
                      &ldquo;{ref.excerpt}&rdquo;
                    </blockquote>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Lecture card with donut count
// ---------------------------------------------------------------------------

function LectureCard({ lecture }: { lecture: CurriculumLecture }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 sm:p-5"
      style={{
        background: "rgba(37, 35, 36, 1)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-start gap-4">
        <CountRing n={lecture.objectives_covered} />
        <div className="flex-1 min-w-0 space-y-3">
          <a
            href={lecture.url}
            target="_blank"
            rel="noreferrer"
            className="block text-indigo-300 hover:text-indigo-200 truncate font-mono text-[10px] sm:text-[11px]"
          >
            {lecture.url}
          </a>

          {lecture.key_topics.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1.5">
                Key topics
              </p>
              <div className="flex flex-wrap gap-1.5">
                {lecture.key_topics.map((t, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      color: "rgba(255,255,255,0.75)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {lecture.gaps.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1.5">
                Gaps
              </p>
              <div className="flex flex-wrap gap-1.5">
                {lecture.gaps.map((g, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(244,63,94,0.10)",
                      color: "#fda4af",
                      border: "1px solid rgba(244,63,94,0.25)",
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.li>
  );
}

/**
 * Donut/ring number indicating objectives covered. Pure CSS — built with
 * `conic-gradient` so we avoid pulling in a chart library. The arc length
 * scales from 0 → 360° as ``n`` grows; we cap the visual at 6 to keep small
 * numbers visible without overwhelming the card.
 */
function CountRing({ n }: { n: number }) {
  const cap = 6;
  const pct = Math.min(n, cap) / cap;
  const deg = pct * 360;
  return (
    <div
      className="relative shrink-0 w-14 h-14 rounded-full flex items-center justify-center"
      style={{
        background: `conic-gradient(#6366f1 ${deg}deg, rgba(255,255,255,0.06) ${deg}deg)`,
      }}
    >
      <div
        className="absolute inset-1 rounded-full flex items-center justify-center"
        style={{ background: "#000" }}
      >
        <div className="text-center leading-none">
          <p className="text-base font-bold text-white">{n}</p>
          <p className="text-[8px] uppercase tracking-wider text-white/40 mt-0.5">
            obj
          </p>
        </div>
      </div>
    </div>
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
  const isTop = recommendation.priority === 1;
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-2xl p-4 sm:p-5 flex gap-4"
      style={{
        background: "rgba(37, 35, 36, 1)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: isTop
          ? "3px solid #f59e0b"
          : "3px solid rgba(255,255,255,0.18)",
      }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center"
        style={{
          background: isTop ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
          color: isTop ? "#fbbf24" : "rgba(255,255,255,0.65)",
          border: `1px solid ${
            isTop ? "rgba(245,158,11,0.40)" : "rgba(255,255,255,0.10)"
          }`,
        }}
      >
        {recommendation.priority}
      </div>
      <div className="space-y-1 min-w-0">
        <p className="text-sm font-semibold text-white">
          {recommendation.gap}
        </p>
        <p className="text-sm text-white/65 leading-relaxed">
          {recommendation.suggestion}
        </p>
      </div>
    </motion.li>
  );
}

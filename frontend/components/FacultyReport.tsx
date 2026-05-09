"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  formatTime,
  getFacultyReport,
  type AuditDimension,
  type AuditFinding,
  type AuditReport,
  type AuditSeverity,
  type AuditStrength,
  type FacultyReportResponse,
  type PriorityFix,
} from "@/lib/api";
import RoleHeader from "@/components/RoleHeader";
import TimestampButton from "@/components/TimestampButton";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "@/components/YouTubePlayer";

type TabKey = "priority" | "full" | "strengths";

const TABS: { key: TabKey; label: string }[] = [
  { key: "priority", label: "Priority Fix" },
  { key: "full", label: "Full Audit" },
  { key: "strengths", label: "Strengths" },
];

const DIMENSION_META: Record<
  AuditDimension,
  { label: string; tone: string }
> = {
  pedagogical: {
    label: "Pedagogical Clarity",
    tone: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  },
  accessibility: {
    label: "Accessibility",
    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  equity: {
    label: "Equity & Inclusion",
    tone: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  },
  language: {
    label: "Language & Tone",
    tone: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  },
};

const SEVERITY_META: Record<AuditSeverity, { label: string; tone: string }> = {
  high: { label: "High", tone: "bg-rose-500/20 text-rose-300" },
  medium: { label: "Medium", tone: "bg-amber-500/20 text-amber-300" },
  low: { label: "Low", tone: "bg-slate-500/20 text-slate-300" },
};

export default function FacultyReport({ jobId }: { jobId: string }) {
  const [data, setData] = useState<FacultyReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("priority");
  const playerRef = useRef<YouTubePlayerHandle>(null);

  const seekTo = (seconds: number) => playerRef.current?.seekTo(seconds);

  useEffect(() => {
    getFacultyReport(jobId)
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
          <Link href="/faculty" className="text-indigo-400 hover:text-indigo-300">
            ← Audit another lecture
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

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen p-3 sm:p-4 md:p-6"
    >
      <RoleHeader>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Private — only visible to you
        </span>
      </RoleHeader>

      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">
          Lecture Audit Report
        </h1>
        <p className="text-sm text-slate-500 mb-6 sm:hidden">
          Private — only visible to you
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
          {/* Left: video — 60% */}
          <section className="lg:col-span-3 lg:sticky lg:top-6 lg:self-start">
            {data.video_id ? (
              <YouTubePlayer ref={playerRef} videoId={data.video_id} />
            ) : (
              <div className="w-full aspect-video bg-slate-900 rounded-xl border border-slate-800" />
            )}
          </section>

          {/* Right: tabs — 40% */}
          <section className="lg:col-span-2 flex flex-col min-w-0">
            <nav className="flex gap-1 border-b border-slate-800 mb-4 sm:mb-5 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                    tab === t.key
                      ? "text-slate-100"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t.label}
                  {tab === t.key && (
                    <motion.span
                      layoutId="faculty-tab-underline"
                      className="absolute left-0 right-0 -bottom-px h-0.5 bg-indigo-500"
                    />
                  )}
                </button>
              ))}
            </nav>

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {tab === "priority" && (
                  <PriorityFixView
                    fix={data.audit_report.priority_fix}
                    onSeek={seekTo}
                  />
                )}
                {tab === "full" && (
                  <FullAuditView
                    findings={data.audit_report.findings}
                    onSeek={seekTo}
                  />
                )}
                {tab === "strengths" && (
                  <StrengthsView
                    strengths={data.audit_report.strengths}
                    onSeek={seekTo}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      </div>
    </motion.main>
  );
}

// ---------------------------------------------------------------------------
// Priority fix
// ---------------------------------------------------------------------------

function PriorityFixView({
  fix,
  onSeek,
}: {
  fix: PriorityFix;
  onSeek: (seconds: number) => void;
}) {
  return (
    <article className="p-5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-indigo-300">
          Top priority fix
        </span>
        <TimestampButton seconds={fix.timestamp} onSeek={onSeek} />
      </div>
      <h2 className="text-xl font-semibold text-slate-100 leading-snug">
        {fix.title}
      </h2>
      <Block label="What's wrong">{fix.issue}</Block>
      <Block label="Why it matters">{fix.why_it_matters}</Block>
      <div>
        <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">
          Original moment
        </p>
        <blockquote className="text-sm italic text-slate-400 leading-relaxed border-l-2 border-slate-700 pl-3">
          &ldquo;{fix.original_text}&rdquo;
        </blockquote>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider text-emerald-400 mb-2">
          Suggested rewrite
        </p>
        <p className="text-sm text-slate-200 leading-relaxed border-l-2 border-emerald-500/40 pl-3">
          {fix.suggested_rewrite}
        </p>
      </div>
      <div className="pt-2">
        <TimestampButton
          seconds={fix.timestamp}
          onSeek={onSeek}
          variant="prominent"
          label={`Jump to ${formatTime(fix.timestamp)}`}
        />
      </div>
    </article>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </p>
      <p className="text-sm text-slate-200 leading-relaxed">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full audit (grouped by dimension)
// ---------------------------------------------------------------------------

function FullAuditView({
  findings,
  onSeek,
}: {
  findings: AuditFinding[];
  onSeek: (seconds: number) => void;
}) {
  if (!findings?.length) {
    return <p className="text-slate-500">No findings to show.</p>;
  }

  // Group by dimension, preserve order from DIMENSION_META keys.
  const groups = (Object.keys(DIMENSION_META) as AuditDimension[])
    .map((dim) => ({
      dim,
      items: findings.filter((f) => f.dimension === dim),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {groups.map(({ dim, items }) => (
        <section key={dim} className="space-y-3">
          <div
            className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${DIMENSION_META[dim].tone}`}
          >
            {DIMENSION_META[dim].label}
          </div>
          <ul className="space-y-3">
            {items.map((f, i) => (
              <FindingCard key={i} finding={f} onSeek={onSeek} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FindingCard({
  finding,
  onSeek,
}: {
  finding: AuditFinding;
  onSeek: (seconds: number) => void;
}) {
  const sev = SEVERITY_META[finding.severity];
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="p-4 rounded-lg border border-slate-800 bg-slate-900/40 space-y-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-sm text-slate-100">{finding.title}</h3>
        <TimestampButton seconds={finding.timestamp} onSeek={onSeek} />
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${sev.tone}`}
        >
          {sev.label} severity
        </span>
      </div>
      <p className="text-sm text-slate-300 leading-relaxed">{finding.issue}</p>
      <blockquote className="text-xs italic text-slate-500 leading-relaxed border-l-2 border-slate-800 pl-3">
        &ldquo;{finding.original_text}&rdquo;
      </blockquote>
      <p className="text-sm text-slate-200 leading-relaxed border-l-2 border-emerald-500/40 pl-3">
        <span className="text-xs uppercase tracking-wider text-emerald-400 block mb-1">
          Try instead
        </span>
        {finding.suggested_rewrite}
      </p>
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Strengths
// ---------------------------------------------------------------------------

function StrengthsView({
  strengths,
  onSeek,
}: {
  strengths: AuditStrength[];
  onSeek: (seconds: number) => void;
}) {
  if (!strengths?.length) {
    return <p className="text-slate-500">No strengths flagged yet.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400 leading-relaxed">
        Things you&apos;re doing well — keep it up.
      </p>
      {strengths.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5"
        >
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="font-semibold text-sm text-slate-100">{s.title}</h3>
            <TimestampButton seconds={s.timestamp} onSeek={onSeek} />
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {s.description}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

// Avoid an unused-import warning when AuditReport is referenced only in the
// imports for documentation purposes.
export type { AuditReport };

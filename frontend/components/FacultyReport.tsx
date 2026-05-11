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
import SwitchRoleButton from "@/components/SwitchRoleButton";
import TimestampButton from "@/components/TimestampButton";
import Image from "next/image";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "@/components/YouTubePlayer";

// ---------------------------------------------------------------------------
// Per-dimension theming (each color shifts the section's accent stripe,
// header, badge, and rewrite block).
// ---------------------------------------------------------------------------

const DIMENSION_META: Record<
  AuditDimension,
  {
    label: string;
    color: string; // primary accent (#hex)
    bgTint: string;
  }
> = {
  pedagogical: {
    label: "Pedagogical Clarity",
    color: "#3b82f6",
    bgTint: "rgba(59,130,246,0.06)",
  },
  accessibility: {
    label: "Accessibility",
    color: "#10b981",
    bgTint: "rgba(16,185,129,0.06)",
  },
  equity: {
    label: "Equity & Inclusion",
    color: "#8b5cf6",
    bgTint: "rgba(139,92,246,0.06)",
  },
  language: {
    label: "Language & Tone",
    color: "#f97316",
    bgTint: "rgba(249,115,22,0.06)",
  },
};

const SEVERITY_META: Record<
  AuditSeverity,
  { label: string; bg: string; color: string }
> = {
  high: {
    label: "High",
    bg: "rgba(244,63,94,0.18)",
    color: "#fda4af",
  },
  medium: {
    label: "Medium",
    bg: "rgba(245,158,11,0.18)",
    color: "#fcd34d",
  },
  low: {
    label: "Low",
    bg: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.65)",
  },
};

// ---------------------------------------------------------------------------
// Top component
// ---------------------------------------------------------------------------

export default function FacultyReport({ jobId }: { jobId: string }) {
  const [data, setData] = useState<FacultyReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        <div className="text-center max-w-md glass-card p-8">
          <p className="text-rose-300 mb-4 text-sm">Error: {error}</p>
          <Link
            href="/faculty"
            className="text-indigo-300 hover:text-indigo-200"
          >
            ← Audit another lecture
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

  return (
    <main className="h-screen flex flex-col">
      <FacultyTopNav />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[55%_45%] min-h-0 overflow-hidden">
        {/* ----- Left ----- */}
        <section className="flex flex-col gap-3 p-4 sm:p-6 overflow-y-auto">
          {data.video_id ? (
            <YouTubePlayer ref={playerRef} videoId={data.video_id} />
          ) : (
            <div className="w-full aspect-video bg-black rounded-xl border border-white/[0.06]" />
          )}
        </section>

        {/* ----- Right (scrollable report) ----- */}
        <section
          className="flex flex-col min-h-0 lg:border-l overflow-y-auto"
          style={{ borderWidth: "4px", borderColor: "rgba(255, 255, 255, 0.08)" }}
        >
          <div className="p-4 sm:p-6 space-y-6">
            <StrengthsCard
              strengths={data.audit_report.strengths}
              onSeek={seekTo}
            />
            
            <PriorityFixCard
              fix={data.audit_report.priority_fix}
              onSeek={seekTo}
            />

            <FindingsByDimension
              findings={data.audit_report.findings}
              onSeek={seekTo}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Top nav (frosted)
// ---------------------------------------------------------------------------

function FacultyTopNav() {
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

function PrivateBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full text-indigo-300"
      style={{
        background: "rgba(99,102,241,0.08)",
        border: "1px solid rgba(99,102,241,0.25)",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
      Private
    </span>
  );
}

// ---------------------------------------------------------------------------
// Priority fix — always visible at the top of the right panel
// ---------------------------------------------------------------------------

function PriorityFixCard({
  fix,
  onSeek,
}: {
  fix: PriorityFix;
  onSeek: (seconds: number) => void;
}) {
  return (
    <article
      className="p-5 sm:p-6 rounded-2xl space-y-4"
      style={{
        backgroundColor: "rgba(37, 35, 36, 1)",
        border: "1px solid rgba(245,158,11,0.30)",
        boxShadow: "0 0 24px rgba(245,158,11,0.08)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ color: "#fbbf24" }}
        >
          <span aria-hidden>⚡</span>
          Top Priority
        </span>
        <TimestampButton
          seconds={fix.timestamp}
          onSeek={onSeek}
          tone="amber"
        />
      </div>
      <h2 className="text-lg sm:text-xl font-semibold text-white leading-snug">
        {fix.title}
      </h2>
      <Block label="What's wrong">{fix.issue}</Block>
      <Block label="Why it matters">{fix.why_it_matters}</Block>

      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">
          Original moment
        </p>
        <blockquote
          className="text-sm italic text-white/55 leading-relaxed pl-3"
          style={{ borderLeft: "2px solid rgba(255,255,255,0.12)" }}
        >
          &ldquo;{fix.original_text}&rdquo;
        </blockquote>
      </div>
      <div
        className="rounded-xl p-4"
        style={{
          background: "rgba(16,185,129,0.04)",
          border: "1px solid rgba(16,185,129,0.20)",
          borderLeft: "3px solid #10b981",
        }}
      >
        <p
          className="text-[10px] uppercase tracking-[0.2em] mb-1.5"
          style={{ color: "#34d399" }}
        >
          Suggested rewrite
        </p>
        <p className="text-sm text-white leading-relaxed">
          {fix.suggested_rewrite}
        </p>
      </div>
      <TimestampButton
        seconds={fix.timestamp}
        onSeek={onSeek}
        variant="prominent"
        label={`Jump to ${formatTime(fix.timestamp)}`}
      />
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
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1.5">
        {label}
      </p>
      <p className="text-sm text-white/85 leading-relaxed">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strengths
// ---------------------------------------------------------------------------

function StrengthsCard({
  strengths,
  onSeek,
}: {
  strengths: AuditStrength[];
  onSeek: (seconds: number) => void;
}) {
  if (!strengths?.length) return null;
  return (
    <section
      className="p-4 sm:p-5 rounded-2xl space-y-3"
      style={{
        backgroundColor: "rgba(37, 35, 36, 1)",
        border: "1px solid rgba(16,185,129,0.20)",
      }}
    >
      <header className="flex items-center justify-between gap-3 mb-1">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] font-semibold"
          style={{ color: "#34d399" }}
        >
          <span aria-hidden>✓</span>
          Strengths
        </span>
        <span
          className="text-[11px] px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(16,185,129,0.12)",
            color: "#34d399",
          }}
        >
          {strengths.length}
        </span>
      </header>
      <p className="text-xs text-white/55 leading-relaxed">
        Things you&apos;re doing well — keep it up.
      </p>
      {strengths.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
          className="rounded-xl p-3 sm:p-4"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderLeft: "2px solid #10b981",
          }}
        >
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="font-medium text-sm text-white">{s.title}</h3>
            <TimestampButton
              seconds={s.timestamp}
              onSeek={onSeek}
              tone="green"
            />
          </div>
          <p className="text-sm text-white/75 leading-relaxed">
            {s.description}
          </p>
        </motion.div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Full audit — collapsible per-dimension sections
// ---------------------------------------------------------------------------

function FindingsByDimension({
  findings,
  onSeek,
}: {
  findings: AuditFinding[];
  onSeek: (seconds: number) => void;
}) {
  if (!findings?.length) return null;
  const groups = (Object.keys(DIMENSION_META) as AuditDimension[])
    .map((dim) => ({
      dim,
      items: findings.filter((f) => f.dimension === dim),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3">
      {groups.map(({ dim, items }, i) => (
        <DimensionSection
          key={dim}
          dimension={dim}
          findings={items}
          onSeek={onSeek}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  );
}

function DimensionSection({
  dimension,
  findings,
  onSeek,
  defaultOpen,
}: {
  dimension: AuditDimension;
  findings: AuditFinding[];
  onSeek: (seconds: number) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = DIMENSION_META[dimension];

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: "rgba(37, 35, 36, 1)",
        border: `1px solid ${meta.color}33`,
        borderLeft: `3px solid ${meta.color}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-semibold text-sm sm:text-base"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{
              background: `${meta.color}1f`,
              color: meta.color,
            }}
          >
            {findings.length}
          </span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            color: meta.color,
          }}
          aria-hidden
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <ul className="space-y-3 p-4 pt-0">
              {findings.map((f, idx) => (
                <FindingRow
                  key={idx}
                  finding={f}
                  accent={meta.color}
                  onSeek={onSeek}
                />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function FindingRow({
  finding,
  accent,
  onSeek,
}: {
  finding: AuditFinding;
  accent: string;
  onSeek: (seconds: number) => void;
}) {
  const sev = SEVERITY_META[finding.severity];
  return (
    <li
      className="rounded-xl p-4 space-y-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-sm text-white">{finding.title}</h3>
        <TimestampButton
          seconds={finding.timestamp}
          onSeek={onSeek}
          tone="indigo"
        />
      </div>
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md"
          style={{ background: sev.bg, color: sev.color }}
        >
          {sev.label} severity
        </span>
      </div>
      <p className="text-sm text-white/80 leading-relaxed">{finding.issue}</p>
      <blockquote
        className="text-xs italic text-white/45 leading-relaxed pl-3"
        style={{ borderLeft: "2px solid rgba(255,255,255,0.10)" }}
      >
        &ldquo;{finding.original_text}&rdquo;
      </blockquote>
      <div
        className="rounded-lg p-3"
        style={{
          background: `${accent}0d`,
          border: `1px solid ${accent}26`,
          borderLeft: `2px solid ${accent}`,
        }}
      >
        <p
          className="text-[10px] uppercase tracking-[0.2em] mb-1"
          style={{ color: accent }}
        >
          Try instead
        </p>
        <p className="text-sm text-white/90 leading-relaxed">
          {finding.suggested_rewrite}
        </p>
      </div>
    </li>
  );
}



// Re-export so consumers that want the type still resolve it.
export type { AuditReport };

"use client";

import { formatTime } from "@/lib/api";

type TimestampTone = "indigo" | "amber" | "green" | "red";

interface Props {
  seconds: number;
  onSeek: (seconds: number) => void;
  /** "default" = compact pill, "prominent" = filled CTA with play icon. */
  variant?: "default" | "prominent";
  /** Color family for the default pill. Prominent buttons stay indigo. */
  tone?: TimestampTone;
  label?: string;
}

/**
 * A clickable timestamp that calls ``onSeek(seconds)``.
 * Stops event propagation so it can sit inside cards/rows that have their
 * own click handlers (e.g. the flashcard flip).
 */
export default function TimestampButton({
  seconds,
  onSeek,
  variant = "default",
  tone = "indigo",
  label,
}: Props) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSeek(seconds);
  };

  if (variant === "prominent") {
    return (
      <button
        onClick={handleClick}
        className="indigo-button inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs"
      >
        <PlayIcon />
        {label ?? `Jump to ${formatTime(seconds)}`}
      </button>
    );
  }

  // Default: pill with tone-tinted text/border, transparent background
  // until hover. Lives well inside dark frosted cards.
  const toneClasses: Record<TimestampTone, string> = {
    indigo:
      "text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 ring-indigo-500/30",
    amber:
      "text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 ring-amber-500/30",
    green:
      "text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 ring-emerald-500/30",
    red: "text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 ring-rose-500/30",
  };

  return (
    <button
      onClick={handleClick}
      className={`text-[11px] font-mono px-2 py-0.5 rounded-md ring-1 transition-colors shrink-0 ${toneClasses[tone]}`}
    >
      {formatTime(seconds)}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3 2l7 4-7 4z" />
    </svg>
  );
}

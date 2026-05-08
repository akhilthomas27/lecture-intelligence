"use client";

import { formatTime } from "@/lib/api";

interface Props {
  seconds: number;
  onSeek: (seconds: number) => void;
  /** "default" = compact pill, "prominent" = filled CTA with play icon. */
  variant?: "default" | "prominent";
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
        className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium transition-colors flex items-center gap-1.5"
      >
        <PlayIcon />
        {label ?? `Jump to ${formatTime(seconds)}`}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="text-xs font-mono text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 px-2 py-0.5 rounded transition-colors shrink-0"
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

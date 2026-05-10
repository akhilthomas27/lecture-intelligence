"use client";

import { useState } from "react";
import { type Flashcard as FlashcardType } from "@/lib/api";
import TimestampButton from "@/components/TimestampButton";

interface Props {
  card: FlashcardType;
  onSeek: (seconds: number) => void;
  /** Optional controlled flip state (lets the parent flip via Space). */
  flipped?: boolean;
  onFlipChange?: (flipped: boolean) => void;
}

/**
 * Pure CSS 3D flip — no Framer Motion. Front shows the question, back shows
 * the answer + a verbatim source quote + jump/copy actions.
 *
 * Supports both uncontrolled (clicks toggle internal state) and controlled
 * mode (parent passes ``flipped`` and ``onFlipChange``) so the dashboard can
 * bind Space to flip without reaching through a ref.
 */
export default function Flashcard({
  card,
  onSeek,
  flipped: flippedProp,
  onFlipChange,
}: Props) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const isControlled = flippedProp !== undefined;
  const flipped = isControlled ? !!flippedProp : internalFlipped;

  const handleFlip = () => {
    if (onFlipChange) onFlipChange(!flipped);
    if (!isControlled) setInternalFlipped((f) => !f);
  };

  return (
    <div
      onClick={handleFlip}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleFlip();
        }
      }}
      className="relative w-full h-72 sm:h-80 cursor-pointer [perspective:1200px] focus:outline-none"
      aria-pressed={flipped}
    >
      <div
        className="relative w-full h-full [transform-style:preserve-3d]"
        style={{
          transition: "transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front — question */}
        <div className="absolute inset-0 [backface-visibility:hidden] glass-card p-7 sm:p-9 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-[0.22em] text-indigo-400">
            Question
          </p>
          <p className="text-xl sm:text-2xl font-semibold text-white leading-snug">
            {card.question}
          </p>
          <div className="flex items-center justify-between text-[11px] text-white/35">
            <span>Click or press Space to flip</span>
            <FlipIcon />
          </div>
        </div>

        {/* Back — answer + source */}
        <div
          className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] glass-card p-7 sm:p-9 flex flex-col"
          style={{
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.25)",
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.22em] text-indigo-300 mb-3">
            Answer
          </p>
          <p className="text-base sm:text-lg text-white leading-relaxed mb-3 flex-1 overflow-y-auto">
            {card.answer}
          </p>
          {card.source_text && (
            <p className="text-xs text-white/45 italic leading-relaxed border-l-2 border-white/15 pl-3 mb-4 line-clamp-2">
              &ldquo;{card.source_text}&rdquo;
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <CopyButton text={`Q: ${card.question}\n\nA: ${card.answer}`} />
            <TimestampButton seconds={card.source_timestamp} onSeek={onSeek} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Copy button --------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Some browsers reject clipboard writes off a user gesture.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2.5 py-1 rounded-md text-[11px] transition-colors flex items-center gap-1.5 ${
        copied
          ? "text-emerald-300"
          : "text-white/55 hover:text-white"
      }`}
      style={{
        background: copied
          ? "rgba(16,185,129,0.10)"
          : "rgba(255,255,255,0.04)",
        border: `1px solid ${
          copied ? "rgba(16,185,129,0.30)" : "rgba(255,255,255,0.08)"
        }`,
      }}
      aria-label={copied ? "Copied" : "Copy question and answer"}
    >
      {copied ? (
        <>
          <CheckIcon /> Copied
        </>
      ) : (
        <>
          <ClipboardIcon /> Copy
        </>
      )}
    </button>
  );
}

function FlipIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4a4 4 0 014-4h4a4 4 0 014 4v0M14 12a4 4 0 01-4 4H6a4 4 0 01-4-4v0" />
      <path d="M11 6l3-2-3-2M5 10l-3 2 3 2" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="3" width="8" height="11" rx="1.5" />
      <path d="M6 3V2.5A1.5 1.5 0 0 1 7.5 1h1A1.5 1.5 0 0 1 10 2.5V3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8l3.5 3.5L13 5" />
    </svg>
  );
}

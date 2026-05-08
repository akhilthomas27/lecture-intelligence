"use client";

import { useState } from "react";
import { type Flashcard as FlashcardType } from "@/lib/api";
import TimestampButton from "@/components/TimestampButton";

interface Props {
  card: FlashcardType;
  onSeek: (seconds: number) => void;
}

/**
 * A flashcard that flips with a CSS 3D transform when clicked.
 *
 * Front: question.
 * Back: answer + verbatim source quote + copy + jump-to-timestamp buttons.
 */
export default function Flashcard({ card, onSeek }: Props) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      onClick={() => setFlipped((f) => !f)}
      className="relative h-52 sm:h-48 cursor-pointer [perspective:1000px]"
    >
      <div
        className="relative w-full h-full transition-transform duration-500 ease-out [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* Front face */}
        <div className="absolute inset-0 [backface-visibility:hidden] rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col justify-between">
          <p className="font-medium text-slate-100 leading-snug">{card.question}</p>
          <p className="text-xs text-slate-600 self-end">click to flip</p>
        </div>

        {/* Back face — pre-rotated so it shows when the card flips */}
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-lg border border-indigo-900/50 bg-indigo-950/30 p-4 flex flex-col">
          <p className="text-sm text-slate-200 leading-relaxed mb-2 flex-1 overflow-y-auto">
            {card.answer}
          </p>
          {card.source_text && (
            <p className="text-xs text-slate-400 italic mb-3 line-clamp-2">
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
      // Some browsers reject clipboard writes off a user gesture or in
      // insecure contexts; we silently fail rather than disrupting the UI.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
        copied
          ? "text-emerald-400 bg-emerald-500/10"
          : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
      }`}
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

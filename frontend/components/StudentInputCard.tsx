"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitLecture } from "@/lib/api";

const EXAMPLES = [
  {
    label: "3Blue1Brown — Neural networks",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
  },
  {
    label: "Karpathy — Let's build GPT",
    url: "https://www.youtube.com/watch?v=kCc8FmEb1nY",
  },
  {
    label: "3B1B — Essence of calculus",
    url: "https://www.youtube.com/watch?v=WUvTyaaNkzM",
  },
];

export default function StudentInputCard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { job_id } = await submitLecture(url);
      router.push(`/processing?jobId=${job_id}&type=student`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-xl mx-auto"
    >
      <div className="glass-card p-8 sm:p-10">
        <RolePill emoji="🎓" label="Student" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white mt-5 mb-2">
          Student Study Hub
        </h1>
        <p className="text-sm text-white/50 mb-7">
          Turn any lecture into a complete study environment.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="url"
            required
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="glass-input w-full px-4 py-3 text-sm sm:text-base"
          />
          <button
            type="submit"
            disabled={loading || !url}
            className="indigo-button w-full px-5 py-3.5 text-sm sm:text-base"
          >
            {loading ? "Starting…" : "Analyze lecture"}
          </button>
          {error && (
            <p className="text-rose-400 text-sm pt-1" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>

      <ExampleLinks
        examples={EXAMPLES}
        onPick={(u) => setUrl(u)}
        disabled={loading}
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits used by all three input cards
// ---------------------------------------------------------------------------

export function RolePill({
  emoji,
  label,
}: {
  emoji: string;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] sm:text-xs font-medium tracking-wide"
      style={{
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        color: "rgba(255, 255, 255, 0.75)",
      }}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
    </span>
  );
}

interface ExampleLink {
  label: string;
  url: string;
}

export function ExampleLinks({
  examples,
  onPick,
  disabled,
}: {
  examples: ExampleLink[];
  onPick: (url: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-2">
      {examples.map((ex) => (
        <button
          key={ex.url}
          type="button"
          onClick={() => onPick(ex.url)}
          disabled={disabled}
          className="text-xs sm:text-sm text-white/40 hover:text-indigo-300 hover:underline disabled:opacity-50 transition-colors"
        >
          {ex.label}
        </button>
      ))}
    </div>
  );
}

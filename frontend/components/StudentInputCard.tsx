"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitLecture } from "@/lib/api";

const FEATURED_EXAMPLE_URL = "https://www.youtube.com/watch?v=aircAruvnKk";

const MORE_EXAMPLES = [
  {
    label: "Karpathy — Let's build GPT from scratch",
    url: "https://www.youtube.com/watch?v=kCc8FmEb1nY",
  },
  {
    label: "3Blue1Brown — Essence of calculus, ch. 1",
    url: "https://www.youtube.com/watch?v=WUvTyaaNkzM",
  },
];

export default function StudentInputCard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(target: string) {
    setError(null);
    setLoading(true);
    try {
      const { job_id } = await submitLecture(target);
      router.push(`/processing?jobId=${job_id}&type=student`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(url);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="space-y-6"
    >
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
          className="w-full px-4 sm:px-5 py-3 sm:py-4 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all text-base placeholder:text-slate-600"
        />
        <button
          type="submit"
          disabled={loading || !url}
          className="w-full px-5 py-3 sm:py-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold transition-colors"
        >
          {loading ? "Starting…" : "Analyze lecture"}
        </button>
        <button
          type="button"
          onClick={() => setUrl(FEATURED_EXAMPLE_URL)}
          disabled={loading}
          className="w-full px-5 py-3 rounded-xl border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/5 disabled:opacity-50 text-slate-300 hover:text-indigo-300 font-medium text-sm transition-colors flex items-center justify-center gap-2"
        >
          <span>✨</span>
          <span>Try example lecture</span>
        </button>
        {error && <p className="text-rose-400 text-sm pt-1">{error}</p>}
      </form>

      <div className="pt-4 border-t border-slate-800">
        <p className="text-slate-500 text-xs sm:text-sm mb-3">
          Or pick another:
        </p>
        <ul className="space-y-2">
          {MORE_EXAMPLES.map((ex) => (
            <li key={ex.url}>
              <button
                type="button"
                onClick={() => setUrl(ex.url)}
                className="group w-full text-left text-xs sm:text-sm text-slate-400 hover:text-slate-100 transition-colors flex items-baseline gap-2"
              >
                <span className="text-slate-600 group-hover:text-indigo-400 transition-colors shrink-0">
                  →
                </span>
                <span>{ex.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

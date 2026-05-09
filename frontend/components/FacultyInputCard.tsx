"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitFacultyLecture } from "@/lib/api";

export default function FacultyInputCard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { job_id } = await submitFacultyLecture(url);
      router.push(`/processing?jobId=${job_id}&type=faculty`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setLoading(false);
    }
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
          {loading ? "Starting audit…" : "Audit my lecture"}
        </button>
        {error && <p className="text-rose-400 text-sm pt-1">{error}</p>}
      </form>

      <div className="pt-4 border-t border-slate-800 text-xs text-slate-500 leading-relaxed">
        Your lecture is processed once and never shared. The audit covers
        pedagogical clarity, accessibility, equity & inclusion, and language
        & tone — with timestamped, concrete suggestions.
      </div>
    </motion.div>
  );
}

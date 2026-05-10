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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-xl mx-auto"
    >
      <div className="glass-card w-full max-w-2xl p-8 sm:p-10 border border-white/20 shadow-2xl shadow-black/40">
        <h1 className="text-center text-2xl sm:text-3xl font-bold text-white mb-2">
          Faculty Lecture Audit
        </h1>
        <p className="text-center text-sm text-white/50 mb-7">
          Get private, actionable feedback on your lecture before it goes live.
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
            {loading ? "Starting audit…" : "Audit my lecture"}
          </button>
          {error && (
            <p className="text-rose-400 text-sm pt-1" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </motion.div>
  );
}

"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitFacultyLecture } from "@/lib/api";
import { ExampleLinks, RolePill } from "@/components/StudentInputCard";

const EXAMPLES = [
  {
    label: "MIT OCW — Linear algebra, lec. 1",
    url: "https://www.youtube.com/watch?v=ZK3O402wf1c",
  },
  {
    label: "Stanford — CS229 lec. 1",
    url: "https://www.youtube.com/watch?v=jGwO_UgTS7I",
  },
  {
    label: "Harvard — CS50 lec. 0",
    url: "https://www.youtube.com/watch?v=YoXxevp1WRQ",
  },
];

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
      <div className="glass-card p-8 sm:p-10">
        <RolePill emoji="🏛️" label="Faculty" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white mt-5 mb-2">
          Faculty Lecture Audit
        </h1>
        <p className="text-sm text-white/50 mb-7">
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

        <p className="mt-6 pt-5 text-[11px] sm:text-xs text-white/40 leading-relaxed border-t border-white/[0.06]">
          Your lecture is processed once and never shared. The audit covers
          pedagogical clarity, accessibility, equity & inclusion, and language
          & tone — with timestamped, concrete suggestions.
        </p>
      </div>

      <ExampleLinks
        examples={EXAMPLES}
        onPick={(u) => setUrl(u)}
        disabled={loading}
      />
    </motion.div>
  );
}

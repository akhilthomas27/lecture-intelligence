"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitProvostCourse } from "@/lib/api";

const MAX_URLS = 10;

export default function ProvostInputCard() {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([""]);
  const [objectives, setObjectives] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setUrlAt(idx: number, value: string) {
    setUrls((prev) => prev.map((u, i) => (i === idx ? value : u)));
  }

  function addUrl() {
    setUrls((prev) => (prev.length >= MAX_URLS ? prev : [...prev, ""]));
  }

  function removeUrl(idx: number) {
    setUrls((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanedUrls = urls.map((u) => u.trim()).filter(Boolean);
    if (cleanedUrls.length === 0) {
      setError("Add at least one lecture URL.");
      return;
    }
    if (!objectives.trim()) {
      setError("Add your course's learning objectives.");
      return;
    }

    setLoading(true);
    try {
      const { job_id } = await submitProvostCourse(cleanedUrls, objectives);
      router.push(`/processing?jobId=${job_id}&type=provost`);
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
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Lecture URLs */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <label className="text-sm text-slate-300">
              Lecture URLs{" "}
              <span className="text-slate-600 text-xs">
                ({urls.length}/{MAX_URLS})
              </span>
            </label>
          </div>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {urls.map((url, idx) => (
                <motion.li
                  key={idx}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="url"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={`Lecture #${idx + 1} URL`}
                    value={url}
                    onChange={(e) => setUrlAt(idx, e.target.value)}
                    className="flex-1 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all text-sm placeholder:text-slate-600 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeUrl(idx)}
                    disabled={urls.length === 1}
                    aria-label={`Remove lecture ${idx + 1}`}
                    className="shrink-0 w-9 h-9 rounded-lg border border-slate-800 text-slate-500 hover:text-rose-300 hover:border-rose-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <button
            type="button"
            onClick={addUrl}
            disabled={urls.length >= MAX_URLS}
            className="mt-3 px-4 py-2 rounded-lg border border-dashed border-slate-700 hover:border-indigo-500/60 hover:bg-indigo-500/5 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-slate-400 hover:text-indigo-300 transition-colors w-full"
          >
            + Add another lecture
          </button>
        </section>

        {/* Objectives */}
        <section>
          <label
            htmlFor="objectives"
            className="block text-sm text-slate-300 mb-2"
          >
            Course learning objectives
          </label>
          <textarea
            id="objectives"
            required
            value={objectives}
            onChange={(e) => setObjectives(e.target.value)}
            placeholder={"One per line, e.g.\n• Students can describe the difference between supervised and unsupervised learning.\n• Students can compute gradients of common loss functions by hand."}
            rows={6}
            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all text-sm placeholder:text-slate-600 leading-relaxed resize-y"
          />
        </section>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-5 py-3 sm:py-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold transition-colors"
        >
          {loading ? "Building coverage map…" : "Build coverage map"}
        </button>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
      </form>
    </motion.div>
  );
}

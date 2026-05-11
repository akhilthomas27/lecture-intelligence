"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitProvostCourse, validatePlaylist } from "@/lib/api";

const MAX_URLS = 15;

export default function ProvostInputCard() {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([""]);
  const [objectives, setObjectives] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playlist state
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistSuccess, setPlaylistSuccess] = useState<string | null>(null);

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

  // Fetch playlist and populate URL inputs
  async function handleImportPlaylist() {
    if (!playlistUrl.trim()) {
      setPlaylistError("Enter a YouTube playlist URL first.");
      return;
    }
    setPlaylistError(null);
    setPlaylistSuccess(null);
    setPlaylistLoading(true);

    try {
      const result = await validatePlaylist(playlistUrl.trim());
      const newUrls = result.videos.map((v) => v.url);
      // Fill existing inputs and add more if needed
      setUrls(newUrls.length > 0 ? newUrls : [""]);
      setPlaylistUrl("");
      setPlaylistSuccess(
        `Imported ${result.video_count} lecture${result.video_count === 1 ? "" : "s"} from playlist.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch playlist";
      // Try to parse the detail from FastAPI error
      try {
        const parsed = JSON.parse(msg);
        setPlaylistError(parsed.error ?? msg);
      } catch {
        setPlaylistError(msg);
      }
    } finally {
      setPlaylistLoading(false);
    }
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-2xl mx-auto"
    >
      <div className="glass-card p-8 sm:p-10">
        <h1 className="text-center text-2xl sm:text-3xl font-bold text-white mb-2">
          Curriculum Coverage Map
        </h1>
        <p className="text-center text-sm text-white/50 mb-7">
          Verify your course is delivering on its stated learning objectives.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Course URL (playlist import) ── */}
          <section>
            <label className="block text-xs sm:text-sm text-white/70 mb-2.5">
              Course URL
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  color: "rgba(255,255,255,0.3)",
                  fontWeight: 400,
                }}
              >
                Import all lectures from a YouTube playlist
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://youtube.com/playlist?list=..."
                value={playlistUrl}
                onChange={(e) => {
                  setPlaylistUrl(e.target.value);
                  setPlaylistError(null);
                  setPlaylistSuccess(null);
                }}
                className="glass-input flex-1 px-4 py-3 text-sm min-w-0"
              />
              <button
                type="button"
                onClick={handleImportPlaylist}
                disabled={playlistLoading || !playlistUrl.trim()}
                className="shrink-0 px-4 py-3 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: playlistLoading || !playlistUrl.trim()
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(99,102,241,0.85)",
                  color: playlistLoading || !playlistUrl.trim()
                    ? "rgba(255,255,255,0.3)"
                    : "#ffffff",
                  border: "1px solid rgba(99,102,241,0.3)",
                  cursor: playlistLoading || !playlistUrl.trim()
                    ? "not-allowed"
                    : "pointer",
                  minWidth: 90,
                }}
              >
                {playlistLoading ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                      style={{
                        display: "block",
                        width: 12, height: 12,
                        borderRadius: "50%",
                        border: "2px solid rgba(255,255,255,0.2)",
                        borderTopColor: "#ffffff",
                      }}
                    />
                    Loading
                  </span>
                ) : (
                  "Import"
                )}
              </button>
            </div>

            {/* Playlist feedback messages */}
            <AnimatePresence>
              {playlistError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-rose-400 text-xs mt-2"
                  role="alert"
                >
                  {playlistError}
                </motion.p>
              )}
              {playlistSuccess && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ color: "#10b981", fontSize: 12, marginTop: 6 }}
                >
                  ✓ {playlistSuccess}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 16,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                or add lectures individually
              </span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
            </div>
          </section>

          {/* ── Individual Lecture URLs ── */}
          <section>
            <div className="flex items-baseline justify-between mb-2.5">
              <label className="text-xs sm:text-sm text-white/70">
                Lecture URLs
              </label>
              <span className="text-[11px] text-white/40">
                {urls.length}/{MAX_URLS}
              </span>
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
                      className="glass-input flex-1 px-4 py-3 text-sm min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => removeUrl(idx)}
                      disabled={urls.length === 1}
                      aria-label={`Remove lecture ${idx + 1}`}
                      className="shrink-0 w-10 h-10 rounded-lg text-white/40 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
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
              className="add-lecture-btn mt-3 w-full px-4 py-3 rounded-xl text-xs sm:text-sm text-white/55 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{
                background: "transparent",
                border: "1px dashed rgba(255,255,255,0.18)",
              }}
            >
              + Add another lecture
            </button>
          </section>

          {/* ── Learning Objectives ── */}
          <section>
            <label
              htmlFor="objectives"
              className="block text-xs sm:text-sm text-white/70 mb-2.5"
            >
              Course learning objectives
            </label>
            <textarea
              id="objectives"
              required
              value={objectives}
              onChange={(e) => setObjectives(e.target.value)}
              placeholder={
                "One per line, e.g.\n• Students can describe the difference between supervised and unsupervised learning.\n• Students can compute gradients of common loss functions by hand."
              }
              rows={6}
              className="glass-input w-full px-4 py-3 text-sm leading-relaxed resize-y"
              style={{ minHeight: 120 }}
            />
          </section>

          <button
            type="submit"
            disabled={loading}
            className="indigo-button w-full px-5 py-3.5 text-sm sm:text-base"
          >
            {loading ? "Building coverage map…" : "Build coverage map"}
          </button>

          {error && (
            <p className="text-rose-400 text-sm" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>

      <style jsx>{`
        .add-lecture-btn:hover:not(:disabled) {
          background: rgba(99, 102, 241, 0.06) !important;
          border: 1px solid #6366f1 !important;
        }
      `}</style>
    </motion.div>
  );
}
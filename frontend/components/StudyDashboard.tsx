"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  answerLecture,
  formatTime,
  getResults,
  translateMaterials,
  type AnswerResponse,
  type Flashcard as FlashcardType,
  type LectureResult,
  type OutlineSection,
  type StudyMaterials,
  type Summaries,
} from "@/lib/api";
import Flashcard from "@/components/Flashcard";
import SwitchRoleButton from "@/components/SwitchRoleButton";
import TimestampButton from "@/components/TimestampButton";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "@/components/YouTubePlayer";

type TabKey = "outline" | "summary" | "flashcards" | "search";
type SummaryKey = "summary_90s" | "summary_5min" | "full_summary";

const TABS: { key: TabKey; label: string }[] = [
  { key: "outline", label: "Outline" },
  { key: "summary", label: "Summary" },
  { key: "flashcards", label: "Flashcards" },
  { key: "search", label: "Search" },
];

const LANGUAGES = [
  { code: "en", label: "English", apiName: "English" },
  { code: "es", label: "Español", apiName: "Spanish" },
  { code: "fr", label: "Français", apiName: "French" },
  { code: "de", label: "Deutsch", apiName: "German" },
  { code: "ja", label: "日本語", apiName: "Japanese" },
  { code: "hi", label: "हिन्दी", apiName: "Hindi" },
  { code: "zh", label: "中文", apiName: "Chinese (Simplified)" },
] as const;

const SOURCE_LANGUAGE = "en";

// ---------------------------------------------------------------------------

export default function StudyDashboard({ jobId }: { jobId: string }) {
  const [data, setData] = useState<LectureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("outline");

  // Translation state
  const [language, setLanguage] = useState<string>(SOURCE_LANGUAGE);
  const [translations, setTranslations] = useState<
    Record<string, StudyMaterials>
  >({});
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const seekTo = (seconds: number) => playerRef.current?.seekTo(seconds);

  // ---- Initial load -----------------------------------------------------
  useEffect(() => {
    getResults(jobId)
      .then((r) => setData(r.result))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [jobId]);

  // ---- Lazy translation fetch ------------------------------------------
  useEffect(() => {
    if (language === SOURCE_LANGUAGE) {
      setTranslating(false);
      setTranslationError(null);
      return;
    }
    if (translations[language]) {
      setTranslating(false);
      setTranslationError(null);
      return;
    }

    const lang = LANGUAGES.find((l) => l.code === language);
    if (!lang) return;

    let cancelled = false;
    setTranslating(true);
    setTranslationError(null);

    translateMaterials(jobId, lang.apiName)
      .then((t) => {
        if (cancelled) return;
        setTranslations((prev) => ({
          ...prev,
          [language]: {
            outline: t.outline,
            summaries: t.summaries,
            flashcards: t.flashcards,
          },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setTranslationError(
          err instanceof Error ? err.message : "Translation failed",
        );
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, jobId]);

  // ---- Error / loading shells -------------------------------------------
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md glass-card p-8">
          <p className="text-rose-300 mb-4 text-sm">Error: {error}</p>
          <Link href="/" className="text-indigo-300 hover:text-indigo-200">
            ← Try another lecture
          </Link>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-white/50">Loading…</p>
      </main>
    );
  }

  const activeMaterials: StudyMaterials =
    language === SOURCE_LANGUAGE
      ? {
          outline: data.outline,
          summaries: data.summaries,
          flashcards: data.flashcards,
        }
      : translations[language] ?? {
          outline: [],
          summaries: { summary_90s: "", summary_5min: "", full_summary: "" },
          flashcards: [],
        };

  const showTranslating =
    translating && language !== SOURCE_LANGUAGE && !translations[language];

  // Approximate total duration from the last chunk's end_time, used for
  // the section timeline visualization beneath the player.
  const totalDuration =
    data.chunks?.length > 0
      ? data.chunks[data.chunks.length - 1].end_time ?? 0
      : 0;

  return (
    <main className="h-screen flex flex-col">
      <TopNav
        videoTitle={`Video ${data.video_id}`}
        language={language}
        onLanguageChange={setLanguage}
        translating={translating}
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[55%_45%] min-h-0 overflow-hidden">
        {/* ----- Left panel ----- */}
        <section className="flex flex-col gap-3 p-4 sm:p-6 overflow-y-auto">
          <YouTubePlayer ref={playerRef} videoId={data.video_id} />
          {totalDuration > 0 && (
            <OutlineTimeline
              sections={activeMaterials.outline}
              totalDuration={totalDuration}
              onSeek={seekTo}
            />
          )}
        </section>

        {/* ----- Right panel ----- */}
        <section
          className="flex flex-col min-h-0 lg:border-l"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <nav className="flex items-center px-3 sm:px-4">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-4 py-3.5 text-sm transition-colors whitespace-nowrap ${
                  tab === t.key ? "text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t.label}
                {tab === t.key && (
                  <motion.span
                    layoutId="study-tab-underline"
                    className="absolute left-3 right-3 -bottom-px h-[2px] bg-indigo-500"
                  />
                )}
              </button>
            ))}
          </nav>
          <div
            className="border-t flex-1 overflow-y-auto p-4 sm:p-6"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            {translationError && (
              <div
                className="mb-4 p-3 rounded-xl text-rose-300 text-sm"
                style={{
                  background: "rgba(244,63,94,0.06)",
                  border: "1px solid rgba(244,63,94,0.25)",
                }}
              >
                Translation failed: {translationError}{" "}
                <button
                  onClick={() => setLanguage(SOURCE_LANGUAGE)}
                  className="underline ml-1"
                >
                  back to English
                </button>
              </div>
            )}

            {showTranslating ? (
              <TranslatingState language={language} />
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${tab}-${language}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {tab === "outline" && (
                    <OutlineView
                      outline={activeMaterials.outline}
                      onSeek={seekTo}
                    />
                  )}
                  {tab === "summary" && (
                    <SummaryView summaries={activeMaterials.summaries} />
                  )}
                  {tab === "flashcards" && (
                    <FlashcardsView
                      flashcards={activeMaterials.flashcards}
                      onSeek={seekTo}
                      isActive={tab === "flashcards"}
                    />
                  )}
                  {tab === "search" && (
                    <SearchTab jobId={jobId} onSeek={seekTo} />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Top navigation
// ---------------------------------------------------------------------------

function TopNav({
  videoTitle,
  language,
  onLanguageChange,
  translating,
}: {
  videoTitle: string;
  language: string;
  onLanguageChange: (v: string) => void;
  translating: boolean;
}) {
  return (
    <header className="top-nav flex items-center gap-3 px-4 sm:px-6 h-14 shrink-0">
      <Link
        href="/"
        className="text-white text-sm font-medium tracking-tight hover:text-indigo-300 transition-colors shrink-0"
      >
        Lecture Intelligence
      </Link>
      <div className="flex-1 text-center text-xs sm:text-sm text-white/45 truncate min-w-0 px-2 hidden sm:block">
        {videoTitle}
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <LanguageDropdown
          value={language}
          onChange={onLanguageChange}
          translating={translating}
        />
        <SwitchRoleButton />
      </div>
    </header>
  );
}

function LanguageDropdown({
  value,
  onChange,
  translating,
}: {
  value: string;
  onChange: (v: string) => void;
  translating: boolean;
}) {
  return (
    <label className="relative">
      <span className="sr-only">Language</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="glass-input appearance-none pl-3 pr-9 py-1.5 text-xs sm:text-sm cursor-pointer"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="bg-black">
            {l.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40">
        {translating ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="block w-3 h-3 rounded-full border-2 border-white/15 border-t-indigo-400"
          />
        ) : (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Outline timeline (under the video)
// ---------------------------------------------------------------------------

function OutlineTimeline({
  sections,
  totalDuration,
  onSeek,
}: {
  sections: OutlineSection[];
  totalDuration: number;
  onSeek: (seconds: number) => void;
}) {
  if (!sections.length || totalDuration <= 0) return null;
  return (
    <div className="px-1 pt-1">
      <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-px bg-white/[0.04]">
        {sections.map((s, i) => {
          const next = sections[i + 1];
          const end = next ? next.start_time : totalDuration;
          const width = Math.max(((end - s.start_time) / totalDuration) * 100, 1);
          // Subtle indigo gradient — even segments slightly lighter to make
          // boundaries readable without adding a solid divider.
          const isEven = i % 2 === 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSeek(s.start_time)}
              title={`${formatTime(s.start_time)} · ${s.title}`}
              className="h-full hover:brightness-150 transition-all"
              style={{
                width: `${width}%`,
                background: isEven
                  ? "rgba(99,102,241,0.55)"
                  : "rgba(99,102,241,0.30)",
              }}
            />
          );
        })}
      </div>
      <p className="text-[10px] text-white/30 mt-1.5 text-center">
        Click a segment to jump to that section
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline tab
// ---------------------------------------------------------------------------

function OutlineView({
  outline,
  onSeek,
}: {
  outline: OutlineSection[];
  onSeek: (seconds: number) => void;
}) {
  if (!outline?.length) {
    return <p className="text-white/40">No outline available.</p>;
  }
  return (
    <ol className="space-y-2">
      {outline.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onSeek(s.start_time)}
            className={`outline-row group w-full text-left p-3 rounded-xl border transition-all flex gap-3 items-start ${
              s.level === 1 ? "" : s.level === 2 ? "ml-3 sm:ml-4" : "ml-6 sm:ml-8"
            }`}
            style={{
              background: "rgba(255,255,255,0.025)",
              borderColor: "rgba(255,255,255,0.06)",
            }}
          >
            <TimestampButton
              seconds={s.start_time}
              onSeek={onSeek}
              tone="indigo"
            />
            <div className="flex-1 min-w-0">
              <h3
                className={`font-medium text-white ${
                  s.level === 1 ? "text-base" : "text-sm"
                }`}
              >
                {s.title}
              </h3>
              <p className="text-xs sm:text-sm text-white/50 leading-relaxed mt-1">
                {s.summary}
              </p>
            </div>
          </button>
        </li>
      ))}
      <style jsx>{`
        .outline-row:hover {
          background: rgba(99, 102, 241, 0.05) !important;
          border-left: 2px solid #6366f1 !important;
          padding-left: calc(0.75rem - 1px);
        }
      `}</style>
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Summary tab
// ---------------------------------------------------------------------------

function SummaryView({ summaries }: { summaries: Summaries }) {
  const [variant, setVariant] = useState<SummaryKey>("summary_90s");
  const variants: { key: SummaryKey; label: string }[] = [
    { key: "summary_90s", label: "90 sec" },
    { key: "summary_5min", label: "5 min" },
    { key: "full_summary", label: "Full" },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const active = variant === v.key;
          return (
            <button
              key={v.key}
              onClick={() => setVariant(v.key)}
              className="px-3.5 py-1.5 rounded-full text-xs transition-colors"
              style={
                active
                  ? {
                      background: "#6366f1",
                      color: "#ffffff",
                      border: "1px solid #6366f1",
                    }
                  : {
                      background: "rgba(255,255,255,0.03)",
                      color: "rgba(255,255,255,0.55)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }
              }
            >
              {v.label}
            </button>
          );
        })}
      </div>
      <motion.article
        key={variant}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="glass-tile p-5"
      >
        <p className="whitespace-pre-wrap leading-relaxed text-white text-[13px] sm:text-sm">
          {summaries[variant]}
        </p>
      </motion.article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flashcards tab
// ---------------------------------------------------------------------------

function FlashcardsView({
  flashcards,
  onSeek,
  isActive,
}: {
  flashcards: FlashcardType[];
  onSeek: (seconds: number) => void;
  isActive: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const total = flashcards.length;
  // Reset flip state when switching cards.
  useEffect(() => setFlipped(false), [index]);

  // Keyboard nav while tab is active.
  useEffect(() => {
    if (!isActive || total === 0) return;
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing in form fields.
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(i + 1, total - 1));
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, total]);

  if (!total) return <p className="text-white/40">No flashcards.</p>;
  const card = flashcards[Math.min(index, total - 1)];

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full flex items-center justify-between gap-3">
        <NavArrow
          direction="left"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
        />
        <p className="text-xs text-white/40 tabular-nums">
          Card {index + 1} of {total}
        </p>
        <NavArrow
          direction="right"
          disabled={index >= total - 1}
          onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
        />
      </div>
      <div className="w-full">
        <Flashcard
          key={index}
          card={card}
          onSeek={onSeek}
          flipped={flipped}
          onFlipChange={setFlipped}
        />
      </div>
      <p className="text-[10px] text-white/30 text-center">
        Space to flip · ← → to navigate
      </p>
    </div>
  );
}

function NavArrow({
  direction,
  onClick,
  disabled,
}: {
  direction: "left" | "right";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Previous card" : "Next card"}
      className="w-10 h-10 rounded-full text-white/55 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transform:
            direction === "right" ? "rotate(0deg)" : "rotate(180deg)",
        }}
        aria-hidden
      >
        <path d="M5 3l5 5-5 5" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Search / Ask tab
// ---------------------------------------------------------------------------

function SearchTab({
  jobId,
  onSeek,
}: {
  jobId: string;
  onSeek: (seconds: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    setShowSource(false);
    try {
      const r = await answerLecture(jobId, query);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get an answer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything about this lecture…"
          className="glass-input flex-1 px-4 py-3 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="indigo-button px-4 py-3 text-sm shrink-0"
        >
          {loading ? "…" : "Ask"}
        </button>
      </form>

      {error && <p className="text-rose-300 text-sm">{error}</p>}

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={result.covered ? "covered" : "uncovered"}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-tile p-5 space-y-4 relative"
            style={{
              borderLeft: result.covered
                ? "2px solid #6366f1"
                : "2px solid #f43f5e",
            }}
          >
            <p className="text-[15px] leading-relaxed text-white">
              {result.answer}
            </p>

            {result.covered && result.source_timestamp != null && (
              <TimestampButton
                seconds={result.source_timestamp}
                onSeek={onSeek}
                variant="prominent"
                label={`Jump to this moment · ${formatTime(
                  result.source_timestamp,
                )}`}
              />
            )}

            {result.covered && result.source_text && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowSource((v) => !v)}
                  aria-expanded={showSource}
                  className="text-[11px] text-white/45 hover:text-white transition-colors flex items-center gap-1.5"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      transform: showSource ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                    aria-hidden
                  >
                    <path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {showSource ? "Hide source" : "Show source"}
                </button>
                <AnimatePresence initial={false}>
                  {showSource && (
                    <motion.div
                      key="src"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="mt-2 text-xs italic text-white/45 leading-relaxed border-l-2 border-white/10 pl-3">
                        &ldquo;{result.source_text}&rdquo;
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Translating overlay
// ---------------------------------------------------------------------------

function TranslatingState({ language }: { language: string }) {
  const label =
    LANGUAGES.find((l) => l.code === language)?.label ?? language;
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-8 h-8 rounded-full border-2 border-white/10 border-t-indigo-400"
      />
      <p className="text-sm text-white/55">Translating to {label}…</p>
      <p className="text-xs text-white/30">Usually takes 5–15 seconds.</p>
    </div>
  );
}

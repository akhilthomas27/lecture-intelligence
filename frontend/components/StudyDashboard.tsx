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

type TabKey = "outline" | "summaries" | "flashcards" | "search";
type SummaryKey = "summary_90s" | "summary_5min" | "full_summary";

const TABS: { key: TabKey; label: string }[] = [
  { key: "outline", label: "Outline" },
  { key: "summaries", label: "Summaries" },
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

  // Initial load
  useEffect(() => {
    getResults(jobId)
      .then((r) => setData(r.result))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [jobId]);

  // Lazy translation fetch + cache
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

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <p className="text-rose-400 mb-4 text-sm">Error: {error}</p>
          <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">
            ← Try another lecture
          </Link>
        </div>
      </main>
    );
  }

  // Materials for the active language; empty placeholders if translating.
  const activeMaterials: StudyMaterials | null = data
    ? language === SOURCE_LANGUAGE
      ? {
          outline: data.outline,
          summaries: data.summaries,
          flashcards: data.flashcards,
        }
      : translations[language] ?? null
    : null;

  const showTranslating =
    !!data && translating && language !== SOURCE_LANGUAGE && !translations[language];
  const activeLanguageLabel =
    LANGUAGES.find((l) => l.code === language)?.label ?? language;
  const showSkeleton = !data;

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen p-3 sm:p-4 md:p-6"
    >
      {/* ---------- Header ---------- */}
      <header className="flex items-center justify-between gap-3 mb-4 sm:mb-6 max-w-7xl mx-auto">
        <Link
          href="/student"
          className="text-slate-500 hover:text-slate-200 text-xs sm:text-sm transition-colors shrink-0"
        >
          ← <span className="hidden sm:inline">New lecture</span>
          <span className="sm:hidden">Back</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <LanguageDropdown
            value={language}
            onChange={setLanguage}
            translating={translating}
            disabled={!data}
          />
          <span className="hidden lg:inline text-xs text-slate-600 font-mono truncate">
            {data?.video_id ?? ""}
          </span>
          <SwitchRoleButton />
        </div>
      </header>

      {/* ---------- Body: 60% video / 40% tabs on lg ---------- */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        <section className="lg:col-span-3 lg:sticky lg:top-6 lg:self-start">
          {data ? (
            <YouTubePlayer ref={playerRef} videoId={data.video_id} />
          ) : (
            <VideoSkeleton />
          )}
        </section>

        <section className="lg:col-span-2 flex flex-col min-w-0">
          {/* Tabs nav — horizontally scrollable on tiny screens */}
          <nav className="flex gap-1 border-b border-slate-800 mb-4 sm:mb-5 overflow-x-auto -mx-1 px-1 scrollbar-thin">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? "text-slate-100"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t.label}
                {tab === t.key && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute left-0 right-0 -bottom-px h-0.5 bg-indigo-500"
                  />
                )}
              </button>
            ))}
          </nav>

          {translationError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-rose-300 text-sm">
              Translation failed: {translationError}{" "}
              <button
                onClick={() => setLanguage(SOURCE_LANGUAGE)}
                className="underline ml-1"
              >
                back to English
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {showSkeleton ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <TabSkeleton tab={tab} />
              </motion.div>
            ) : showTranslating ? (
              <motion.div
                key="translating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-16 gap-4"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-8 h-8 rounded-full border-2 border-slate-800 border-t-indigo-400"
                />
                <p className="text-sm text-slate-400">
                  Translating to {activeLanguageLabel}…
                </p>
                <p className="text-xs text-slate-600">
                  Usually takes 5–15 seconds.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={`${tab}-${language}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {tab === "outline" && (
                  <OutlineView
                    outline={activeMaterials?.outline ?? []}
                    onSeek={seekTo}
                  />
                )}
                {tab === "summaries" && (
                  <SummariesView
                    summaries={
                      activeMaterials?.summaries ?? {
                        summary_90s: "",
                        summary_5min: "",
                        full_summary: "",
                      }
                    }
                  />
                )}
                {tab === "flashcards" && (
                  <FlashcardsView
                    flashcards={activeMaterials?.flashcards ?? []}
                    onSeek={seekTo}
                  />
                )}
                {tab === "search" && (
                  <SearchTab jobId={jobId} onSeek={seekTo} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </motion.main>
  );
}

// ---------------------------------------------------------------------------
// Header — language dropdown
// ---------------------------------------------------------------------------

function LanguageDropdown({
  value,
  onChange,
  translating,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  translating: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="relative">
      <span className="sr-only">Language</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-3 pr-9 py-1.5 text-xs sm:text-sm text-slate-300 hover:border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500">
        {translating ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-3 h-3 rounded-full border-2 border-slate-700 border-t-indigo-400"
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
// Skeletons (initial load)
// ---------------------------------------------------------------------------

function VideoSkeleton() {
  return (
    <div className="w-full aspect-video bg-slate-900 rounded-xl border border-slate-800 animate-pulse" />
  );
}

function TabSkeleton({ tab }: { tab: TabKey }) {
  if (tab === "outline") return <OutlineSkeleton />;
  if (tab === "summaries") return <SummariesSkeleton />;
  if (tab === "flashcards") return <FlashcardsSkeleton />;
  return <SearchSkeleton />;
}

function OutlineSkeleton() {
  return (
    <ol className="space-y-2" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="p-3 rounded-lg border border-slate-800 bg-slate-900/40"
        >
          <div className="flex justify-between items-baseline mb-2">
            <div className="h-4 w-2/5 bg-slate-800 rounded animate-pulse" />
            <div className="h-3 w-12 bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-full bg-slate-800 rounded animate-pulse" />
            <div className="h-3 w-3/4 bg-slate-800 rounded animate-pulse" />
          </div>
        </li>
      ))}
    </ol>
  );
}

function SummariesSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-7 w-20 bg-slate-800 rounded-full animate-pulse"
          />
        ))}
      </div>
      <div className="p-5 rounded-lg border border-slate-800 bg-slate-900/40 space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className={`h-3 bg-slate-800 rounded animate-pulse ${
              i === 6 ? "w-1/2" : "w-full"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function FlashcardsSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-48 rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col justify-between animate-pulse"
        >
          <div className="space-y-2">
            <div className="h-4 w-3/4 bg-slate-800 rounded" />
            <div className="h-4 w-1/2 bg-slate-800 rounded" />
          </div>
          <div className="h-3 w-16 bg-slate-800 rounded self-end" />
        </div>
      ))}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-12 w-full bg-slate-800 rounded-lg animate-pulse" />
      <div className="h-10 w-full bg-slate-800 rounded-lg animate-pulse" />
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
    return <p className="text-slate-500">No outline available.</p>;
  }
  return (
    <ol className="space-y-2">
      {outline.map((s, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.03 }}
          className={`p-3 rounded-lg border border-slate-800 bg-slate-900/40 ${
            s.level === 1 ? "" : s.level === 2 ? "ml-3 sm:ml-4" : "ml-6 sm:ml-8"
          }`}
        >
          <div className="flex justify-between items-baseline gap-2 mb-1">
            <h3
              className={`font-semibold ${
                s.level === 1 ? "text-base" : "text-sm"
              }`}
            >
              {s.title}
            </h3>
            <TimestampButton seconds={s.start_time} onSeek={onSeek} />
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">{s.summary}</p>
        </motion.li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Summaries tab
// ---------------------------------------------------------------------------

function SummariesView({ summaries }: { summaries: Summaries }) {
  const [variant, setVariant] = useState<SummaryKey>("summary_90s");
  const variants: { key: SummaryKey; label: string }[] = [
    { key: "summary_90s", label: "90 seconds" },
    { key: "summary_5min", label: "5 minutes" },
    { key: "full_summary", label: "Full" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => (
          <button
            key={v.key}
            onClick={() => setVariant(v.key)}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
              variant === v.key
                ? "bg-indigo-500 text-white"
                : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 hover:border-slate-700"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <motion.article
        key={variant}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-4 sm:p-5 rounded-lg border border-slate-800 bg-slate-900/40"
      >
        <p className="whitespace-pre-wrap leading-relaxed text-slate-200 text-sm">
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
}: {
  flashcards: FlashcardType[];
  onSeek: (seconds: number) => void;
}) {
  if (!flashcards?.length) {
    return <p className="text-slate-500">No flashcards.</p>;
  }
  return (
    <div className="grid gap-4">
      {flashcards.map((c, i) => (
        <Flashcard key={i} card={c} onSeek={onSeek} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search tab
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
  const [showExcerpt, setShowExcerpt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    setShowExcerpt(false);
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
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything about this lecture…"
          className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all placeholder:text-slate-600 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      <AnimatePresence mode="wait">
        {result && result.covered && (
          <motion.div
            key="answer-covered"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-5 rounded-lg border border-indigo-900/50 bg-indigo-950/20 space-y-4"
          >
            {/* Answer — prominent */}
            <p className="text-base text-slate-100 leading-relaxed">
              {result.answer}
            </p>

            {/* Jump to source */}
            {result.source_timestamp != null && (
              <TimestampButton
                seconds={result.source_timestamp}
                onSeek={onSeek}
                variant="prominent"
                label={`Jump to source · ${formatTime(result.source_timestamp)}`}
              />
            )}

            {/* Collapsible transcript excerpt */}
            {result.source_text && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowExcerpt((v) => !v)}
                  aria-expanded={showExcerpt}
                  className="text-xs text-slate-400 hover:text-slate-100 transition-colors flex items-center gap-1.5"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      transform: showExcerpt
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                    aria-hidden
                  >
                    <path
                      d="M3 5l3 3 3-3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {showExcerpt
                    ? "Hide transcript excerpt"
                    : "View transcript excerpt"}
                </button>
                <AnimatePresence initial={false}>
                  {showExcerpt && (
                    <motion.div
                      key="excerpt"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="mt-2 text-xs italic text-slate-400 leading-relaxed border-l-2 border-slate-800 pl-3">
                        &ldquo;{result.source_text}&rdquo;
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}

        {result && !result.covered && (
          <motion.div
            key="answer-not-covered"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-5 rounded-lg border border-slate-800 bg-slate-900/30"
          >
            <p className="text-sm text-slate-500 italic leading-relaxed">
              {result.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  answerLecture,
  formatTime,
  getResults,
  translateMaterials,
  type Flashcard as FlashcardType,
  type LectureResult,
  type OutlineSection,
  type StudyMaterials,
  type Summaries,
  type Chunk,
} from "@/lib/api";
import { createPortal } from "react-dom";
import Flashcard from "@/components/Flashcard";
import Image from "next/image";
import SwitchRoleButton from "@/components/SwitchRoleButton";
import TimestampButton from "@/components/TimestampButton";
import YouTubePlayer, {
  type YouTubePlayerHandle,
} from "@/components/YouTubePlayer";

type TabKey = "outline" | "summary" | "flashcards" | "search";
type SummaryKey = "summary_90s" | "summary_5min" | "full_summary";

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  covered?: boolean;
  source_timestamp?: number | null;
  source_text?: string | null;
  timestamp: Date;
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "outline", label: "Outline" },
  { key: "summary", label: "Summary" },
  { key: "flashcards", label: "Flashcards" },
  { key: "search", label: "Ask" },
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
// Main dashboard
// ---------------------------------------------------------------------------

export default function StudyDashboard({ jobId }: { jobId: string }) {
  const [data, setData] = useState<LectureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("outline");

  // Translation state
  const [language, setLanguage] = useState<string>(SOURCE_LANGUAGE);
  const [translations, setTranslations] = useState<Record<string, StudyMaterials>>({});
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  // Chat history — lives in parent so it persists across tab switches
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  // Current playback time — polled every second for transcript sync
  const [currentTime, setCurrentTime] = useState(0);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const seekTo = (seconds: number) => playerRef.current?.seekTo(seconds);

  // Poll YouTube player for current time
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerRef.current) {
        const time = playerRef.current.getCurrentTime();
        if (typeof time === "number") setCurrentTime(time);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
        setTranslationError(err instanceof Error ? err.message : "Translation failed");
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });

    return () => { cancelled = true; };
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
      ? { outline: data.outline, summaries: data.summaries, flashcards: data.flashcards }
      : translations[language] ?? {
          outline: [],
          summaries: { summary_90s: "", summary_5min: "", full_summary: "" },
          flashcards: [],
        };

  const showTranslating = translating && language !== SOURCE_LANGUAGE && !translations[language];

  const totalDuration =
    data.chunks?.length > 0
      ? data.chunks[data.chunks.length - 1].end_time ?? 0
      : 0;

  function handleNewMessage(msg: ChatMessage) {
    setChatHistory((prev) => [...prev, msg]);
  }

  return (
    <main className="h-screen flex flex-col" style={{ backgroundColor: "#000000" }}>
      <TopNav
        language={language}
        onLanguageChange={setLanguage}
        translating={translating}
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[55%_45%] min-h-0 overflow-hidden">
        {/* ----- Left panel ----- */}
        <section
          className="flex flex-col gap-3 p-4 sm:p-6"
          style={{ overflow: "hidden", minHeight: 0 }}
        >
          <YouTubePlayer ref={playerRef} videoId={data.video_id} />
          {totalDuration > 0 && (
            <OutlineTimeline
              sections={activeMaterials.outline}
              totalDuration={totalDuration}
              onSeek={seekTo}
            />
          )}
          {data.chunks?.length > 0 && (
            <TranscriptPanel
              chunks={data.chunks}
              currentTime={currentTime}
              onSeek={seekTo}
            />
          )}
        </section>

        {/* ----- Right panel ----- */}
        <section
          className="flex flex-col min-h-0 lg:border-l"
          style={{ borderWidth: "4px", borderColor: "rgba(255, 255, 255, 0.08)" }}
        >
          <nav
            className="px-4 py-3 shrink-0"
            style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}
          >
            <div
              className="flex items-center gap-1 p-1 rounded-xl"
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="relative flex-1 py-2 rounded-lg transition-all duration-200"
                  style={{
                    fontSize: 13,
                    fontWeight: tab === t.key ? 600 : 400,
                    color: tab === t.key ? "#ffffff" : "rgba(255,255,255,0.45)",
                    background: tab === t.key ? "rgba(99, 102, 241, 0.85)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: tab === t.key ? "0 2px 8px rgba(99, 102, 241, 0.4)" : "none",
                    letterSpacing: "0.01em",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>

          <div
            className="border-t flex-1 overflow-y-auto p-4 sm:p-6"
            style={{
              borderColor: "rgba(0,0,0,0.08)",
              // Search tab needs full height flex layout — remove overflow for it
              ...(tab === "search"
                ? { display: "flex", flexDirection: "column", overflow: "hidden" }
                : {}),
            }}
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
                <button onClick={() => setLanguage(SOURCE_LANGUAGE)} className="underline ml-1">
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
                  style={tab === "search" ? { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 } : {}}
                >
                  {tab === "outline" && (
                    <OutlineView outline={activeMaterials.outline} onSeek={seekTo} />
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
                    <SearchTab
                      jobId={jobId}
                      onSeek={seekTo}
                      chatHistory={chatHistory}
                      onNewMessage={handleNewMessage}
                    />
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
  language,
  onLanguageChange,
  translating,
}: {
  language: string;
  onLanguageChange: (v: string) => void;
  translating: boolean;
}) {
  return (
    <header
      className="top-nav flex items-center gap-3 px-4 sm:px-6 h-14 shrink-0"
      style={{ backgroundColor: "rgba(37, 35, 36, 1)" }}
    >
      <Link href="/" className="flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Lecture Intelligence"
          width={100}
          height={100}
          style={{ objectFit: "contain", borderRadius: 1 }}
          priority
        />
      </Link>
      <div className="flex-1" />
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <LanguageDropdown value={language} onChange={onLanguageChange} translating={translating} />
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
// Outline timeline
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
                background: isEven ? "rgba(99,102,241,0.55)" : "rgba(99,102,241,0.30)",
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
// Transcript panel
// ---------------------------------------------------------------------------

function TranscriptPanel({
  chunks,
  currentTime,
  onSeek,
}: {
  chunks: Chunk[];
  currentTime: number;
  onSeek: (seconds: number) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const activeRef = useRef<HTMLDivElement>(null);

  const activeIndex = (() => {
    let idx = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (currentTime >= chunks[i].start_time) idx = i;
      else break;
    }
    return idx;
  })();

  const activeChunk = chunks[activeIndex];

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto scroll to active chunk inside modal
  useEffect(() => {
    if (modalOpen && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex, modalOpen]);

  // Close modal on Escape key
  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  return (
    <>
      {/* Collapsed strip — always visible */}
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          overflow: "hidden",
          userSelect: "none",
          WebkitUserSelect: "none",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Header row */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
              <path d="M9 12h6M9 8h6M9 16h4" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
              Transcript
            </span>
            {activeChunk && (
              <span
                style={{
                  fontSize: 11,
                  color: "#6366f1",
                  background: "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatTime(activeChunk.start_time)}
              </span>
            )}
          </div>

          {/* Expand button */}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.4)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.4)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            View full transcript
          </button>
        </div>

        {/* Current chunk preview */}
        {activeChunk && (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(99,102,241,0.3) transparent",
            minHeight: 0,
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {activeChunk.text}
          </p>
        </div>
      )}
      </div>

      {/* Modal — rendered via portal so it covers full viewport */}
      {mounted &&
      createPortal(
          <AnimatePresence>
            {modalOpen && (
              <>
                {/* Backdrop */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setModalOpen(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.75)",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                    zIndex: 9998,
                  }}
                />

                {/* Modal panel */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  style={{
                    position: "fixed",
                    top: "50%",
                    left: "50%",
                    marginTop: "-40vh",
                    marginLeft: "min(-340px, -46vw)",
                    width: "min(680px, 92vw)",
                    maxHeight: "80vh",
                    background: "rgba(15,15,20,0.98)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 20,
                    display: "flex",
                    flexDirection: "column",
                    zIndex: 9999,
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    overflow: "hidden",
                  }}
                >
                  {/* Modal header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "16px 20px",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                        <path d="M9 12h6M9 8h6M9 16h4" strokeLinecap="round" strokeLinejoin="round" />
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#ffffff" }}>
                        Full Transcript
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.35)",
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 4,
                          padding: "2px 8px",
                        }}
                      >
                        {chunks.length} sections
                      </span>
                    </div>

                    {/* Close button */}
                    <button
                      type="button"
                      onClick={() => setModalOpen(false)}
                      style={{
                        width: 32, height: 32,
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer",
                        color: "rgba(255,255,255,0.5)",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,63,94,0.1)";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(244,63,94,0.3)";
                        (e.currentTarget as HTMLButtonElement).style.color = "#f43f5e";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
                        (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)";
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                        <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>

                  {/* Helper text */}
                  <div
                    style={{
                      padding: "8px 20px",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      flexShrink: 0,
                    }}
                  >
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>
                      Click any section to jump to that moment · Press Esc to close
                    </p>
                  </div>

                  {/* Scrollable transcript */}
                  <div
                    style={{ overflowY: "auto", flex: 1, padding: "12px 16px" }}
                    className="space-y-2"
                  >
                    {chunks.map((chunk, i) => {
                      const isActive = i === activeIndex;
                      return (
                        <div
                          key={chunk.chunk_id}
                          ref={isActive ? activeRef : null}
                          onClick={() => {
                            onSeek(chunk.start_time);
                            setModalOpen(false);
                          }}
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                            cursor: "pointer",
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                            border: isActive
                              ? "1px solid rgba(99,102,241,0.3)"
                              : "1px solid transparent",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
                              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.06)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              (e.currentTarget as HTMLDivElement).style.background = "transparent";
                              (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
                            }
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: isActive ? "#6366f1" : "rgba(255,255,255,0.3)",
                              minWidth: 42,
                              paddingTop: 2,
                              fontVariantNumeric: "tabular-nums",
                              flexShrink: 0,
                              fontWeight: isActive ? 600 : 400,
                            }}
                          >
                            {formatTime(chunk.start_time)}
                          </span>
                          <p
                            style={{
                              fontSize: 14,
                              color: isActive ? "#ffffff" : "rgba(255,255,255,0.6)",
                              lineHeight: 1.65,
                              margin: 0,
                            }}
                          >
                            {chunk.text}
                          </p>
                          {isActive && (
                            <div
                              style={{
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                                paddingTop: 4,
                              }}
                            >
                              {[0, 1, 2].map((bar) => (
                                <motion.div
                                  key={bar}
                                  style={{
                                    width: 2,
                                    borderRadius: 2,
                                    background: "#6366f1",
                                  }}
                                  animate={{ height: ["6px", "14px", "6px"] }}
                                  transition={{
                                    duration: 0.8,
                                    repeat: Infinity,
                                    delay: bar * 0.15,
                                    ease: "easeInOut",
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )
      }
    </>
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
              background: "rgba(37, 35, 36, 1)",
              borderColor: "rgba(37, 35, 36, 1)",
            }}
          >
            <TimestampButton seconds={s.start_time} onSeek={onSeek} tone="indigo" />
            <div className="flex-1 min-w-0">
              <h3 className={`font-medium text-white ${s.level === 1 ? "text-base" : "text-sm"}`}>
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
          background: rgba(37, 35, 36, 1) !important;
          border: 2px solid #6366f1 !important;
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
                  ? { background: "#6366f1", color: "#ffffff", border: "1px solid #6366f1" }
                  : { background: "rgba(37,35,36,1)", color: "#ffffff", border: "1px solid rgba(37,35,36,1)" }
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
        {variant === "summary_90s" ? (
          /* 90 sec — plain prose, no headings */
          <p className="whitespace-pre-wrap leading-relaxed text-white text-[13px] sm:text-sm">
            {summaries[variant]}
          </p>
        ) : (
          /* 5 min and Full — parse ## headings and render structured */
          <StructuredSummary text={summaries[variant]} />
        )}
      </motion.article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structured summary renderer
// ---------------------------------------------------------------------------

function StructuredSummary({ text }: { text: string }) {
  if (!text) {
    return (
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
        No summary available.
      </p>
    );
  }

  // Split text into blocks by ## headings
  const lines = text.split("\n");
  
  type Block =
    | { type: "heading"; text: string }
    | { type: "paragraph"; text: string };

  const blocks: Block[] = [];
  let currentParagraphLines: string[] = [];

  function flushParagraph() {
    const joined = currentParagraphLines.join("\n").trim();
    if (joined) {
      blocks.push({ type: "paragraph", text: joined });
    }
    currentParagraphLines = [];
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ type: "heading", text: line.replace(/^##\s+/, "") });
    } else {
      currentParagraphLines.push(line);
    }
  }
  flushParagraph();

  // If no headings found at all — fall back to plain prose
  const hasHeadings = blocks.some((b) => b.type === "heading");
  if (!hasHeadings) {
    return (
      <p className="whitespace-pre-wrap leading-relaxed text-white text-[13px] sm:text-sm">
        {text}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Indigo accent bar */}
              <div
                style={{
                  width: 3,
                  height: 18,
                  borderRadius: 2,
                  background: "#6366f1",
                  flexShrink: 0,
                }}
              />
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#ffffff",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  margin: 0,
                }}
              >
                {block.text}
              </h3>
            </div>
          );
        }

        // Paragraph — split into individual paragraphs by blank lines
        const subParagraphs = block.text
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean);

        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              // Indent paragraphs that follow a heading
              paddingLeft: i > 0 && blocks[i - 1]?.type === "heading" ? 13 : 0,
            }}
          >
            {subParagraphs.map((para, j) => (
              <p
                key={j}
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.8)",
                  lineHeight: 1.75,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {para}
              </p>
            ))}
          </div>
        );
      })}
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

  useEffect(() => setFlipped(false), [index]);

  useEffect(() => {
    if (!isActive || total === 0) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.code === "Space") { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, total]);

  if (!total) return <p className="text-white/40">No flashcards.</p>;
  const card = flashcards[Math.min(index, total - 1)];

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full flex items-center justify-between gap-3">
        <NavArrow direction="left" disabled={index === 0} onClick={() => setIndex((i) => Math.max(i - 1, 0))} />
        <p className="text-xs text-white/100 tabular-nums">Card {index + 1} of {total}</p>
        <NavArrow direction="right" disabled={index >= total - 1} onClick={() => setIndex((i) => Math.min(i + 1, total - 1))} />
      </div>
      <div className="w-full">
        <Flashcard key={index} card={card} onSeek={onSeek} flipped={flipped} onFlipChange={setFlipped} />
      </div>
      <p className="text-[15px] text-white/100 text-center">
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
      style={{ background: "rgba(37,35,36,1)", border: "1px solid rgba(37,35,36,1)" }}
    >
      <svg
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: direction === "right" ? "rotate(0deg)" : "rotate(180deg)" }}
        aria-hidden
      >
        <path d="M5 3l5 5-5 5" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Search / Ask tab — chatbot UI
// ---------------------------------------------------------------------------

function SearchTab({
  jobId,
  onSeek,
  chatHistory,
  onNewMessage,
}: {
  jobId: string;
  onSeek: (seconds: number) => void;
  chatHistory: ChatMessage[];
  onNewMessage: (msg: ChatMessage) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      timestamp: new Date(),
    };
    onNewMessage(userMsg);
    setQuery("");
    setLoading(true);

    try {
      const r = await answerLecture(jobId, query);
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: r.answer,
        covered: r.covered,
        source_timestamp: r.source_timestamp,
        source_text: r.source_text,
        timestamp: new Date(),
      };
      onNewMessage(aiMsg);
    } catch {
      onNewMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
        covered: false,
        timestamp: new Date(),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }} className="space-y-4">

        {/* Empty state */}
        {chatHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div
              style={{
                width: 48, height: 48, borderRadius: 14,
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.75">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", textAlign: "center", fontWeight: 500 }}>
              Ask anything about this lecture
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", textAlign: "center", lineHeight: 1.5 }}>
              I'll find the exact moment in the video<br />that answers your question
            </p>
            {/* Suggested questions */}
            <div className="flex flex-col gap-2 mt-2 w-full max-w-xs">
              {[
                "What are the main topics covered?",
                "Explain the key concept in simple terms",
                "What was the most important takeaway?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setQuery(q)}
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.45)",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.4)";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.75)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.45)";
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {chatHistory.map((msg) => (
          <ChatBubble key={msg.id} message={msg} onSeek={onSeek} />
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex items-start gap-2">
            <div
              style={{
                width: 30, height: 30, borderRadius: "50%",
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 14 }}>🎓</span>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "4px 16px 16px 16px",
                padding: "12px 16px",
                display: "flex", gap: 5, alignItems: "center",
              }}
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "rgba(99,102,241,0.7)",
                  }}
                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar — pinned to bottom */}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 12,
          flexShrink: 0,
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about this lecture…"
            disabled={loading}
            className="glass-input flex-1 px-4 py-3 text-sm"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="indigo-button shrink-0"
            style={{
              width: 44, height: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 12, padding: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat bubble
// ---------------------------------------------------------------------------

function ChatBubble({
  message,
  onSeek,
}: {
  message: ChatMessage;
  onSeek: (seconds: number) => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            maxWidth: "80%",
            background: "#6366f1",
            borderRadius: "16px 4px 16px 16px",
            padding: "10px 14px",
            fontSize: 14,
            color: "#ffffff",
            lineHeight: 1.55,
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      {/* AI avatar */}
      <div
        style={{
          width: 30, height: 30, borderRadius: "50%",
          background: "rgba(99,102,241,0.15)",
          border: "1px solid rgba(99,102,241,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, marginTop: 2,
        }}
      >
        <span style={{ fontSize: 14 }}>🎓</span>
      </div>

      <div style={{ maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Answer bubble */}
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            border: message.covered === false
              ? "1px solid rgba(244,63,94,0.25)"
              : "1px solid rgba(255,255,255,0.08)",
            borderRadius: "4px 16px 16px 16px",
            padding: "10px 14px",
            fontSize: 14,
            color: "#ffffff",
            lineHeight: 1.6,
          }}
        >
          {message.content}
        </div>

        {/* Jump to moment */}
        {message.covered && message.source_timestamp != null && (
          <button
            onClick={() => onSeek(message.source_timestamp!)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 11, color: "#6366f1",
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.2)",
              borderRadius: 6, padding: "4px 10px",
              cursor: "pointer", width: "fit-content",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.15)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.08)";
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <polygon points="5,3 13,8 5,13" />
            </svg>
            Jump to {formatTime(message.source_timestamp)}
          </button>
        )}

        {/* Show source toggle */}
        {message.covered && message.source_text && (
          <div>
            <button
              onClick={() => setShowSource((v) => !v)}
              style={{
                fontSize: 11, color: "rgba(255,255,255,0.35)",
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4, padding: 0,
              }}
            >
              <svg
                width="10" height="10" viewBox="0 0 12 12"
                fill="none" stroke="currentColor" strokeWidth="2"
                style={{ transform: showSource ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
              >
                <path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {showSource ? "Hide source" : "View source"}
            </button>
            <AnimatePresence>
              {showSource && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{
                    fontSize: 11, color: "rgba(255,255,255,0.35)",
                    fontStyle: "italic", lineHeight: 1.5,
                    borderLeft: "2px solid rgba(99,102,241,0.3)",
                    paddingLeft: 8, marginTop: 6,
                    userSelect: "none", WebkitUserSelect: "none",
                  }}
                >
                  "{message.source_text}"
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Translating overlay
// ---------------------------------------------------------------------------

function TranslatingState({ language }: { language: string }) {
  const label = LANGUAGES.find((l) => l.code === language)?.label ?? language;
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
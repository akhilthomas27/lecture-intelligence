import UrlInputCard from "@/components/UrlInputCard";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <header className="text-center mb-10">
          <p className="uppercase tracking-[0.2em] text-xs text-indigo-400 mb-3">
            Lecture Intelligence
          </p>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
            Study any YouTube lecture
          </h1>
          <p className="text-slate-400 text-lg">
            Drop a URL — get an outline, summaries, flashcards, and semantic search.
          </p>
        </header>
        <UrlInputCard />
      </div>
    </main>
  );
}

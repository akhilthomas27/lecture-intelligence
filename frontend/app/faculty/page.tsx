import FacultyInputCard from "@/components/FacultyInputCard";
import RoleHeader from "@/components/RoleHeader";

export default function FacultyPage() {
  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 sm:py-10">
      <RoleHeader>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Private
        </span>
      </RoleHeader>
      <div className="flex flex-col items-center justify-center px-2 py-12 sm:py-16">
        <div className="w-full max-w-2xl">
          <header className="text-center mb-10">
            <p className="uppercase tracking-[0.2em] text-xs text-indigo-400 mb-3">
              Faculty Lecture Audit
            </p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-3 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
              Audit before you teach
            </h1>
            <p className="text-slate-400 text-base sm:text-lg">
              Get private, actionable feedback on your lecture before it goes live.
            </p>
          </header>
          <FacultyInputCard />
        </div>
      </div>
    </main>
  );
}

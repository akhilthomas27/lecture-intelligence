import ProvostInputCard from "@/components/ProvostInputCard";
import RoleHeader from "@/components/RoleHeader";

export default function ProvostPage() {
  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 sm:py-10">
      <RoleHeader />
      <div className="flex flex-col items-center justify-center px-2 py-8 sm:py-12">
        <div className="w-full max-w-3xl">
          <header className="text-center mb-10">
            <p className="uppercase tracking-[0.2em] text-xs text-indigo-400 mb-3">
              Curriculum Coverage Map
            </p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-3 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
              Verify course coverage
            </h1>
            <p className="text-slate-400 text-base sm:text-lg">
              Verify your course is delivering on its stated learning objectives.
            </p>
          </header>
          <ProvostInputCard />
        </div>
      </div>
    </main>
  );
}

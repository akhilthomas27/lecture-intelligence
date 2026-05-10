import FacultyInputCard from "@/components/FacultyInputCard";
import RoleHeader from "@/components/RoleHeader";

export default function FacultyPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <RoleHeader>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full text-indigo-300"
          style={{
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.25)",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Private
        </span>
      </RoleHeader>
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-16">
        <FacultyInputCard />
      </div>
    </main>
  );
}

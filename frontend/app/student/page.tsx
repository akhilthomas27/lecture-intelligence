import RoleHeader from "@/components/RoleHeader";
import StudentInputCard from "@/components/StudentInputCard";

export default function StudentPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <RoleHeader />
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-16">
        <StudentInputCard />
      </div>
    </main>
  );
}

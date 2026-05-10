import ProvostInputCard from "@/components/ProvostInputCard";
import RoleHeader from "@/components/RoleHeader";

export default function ProvostPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <RoleHeader />
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-16">
        <ProvostInputCard />
      </div>
    </main>
  );
}

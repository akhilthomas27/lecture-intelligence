import { redirect } from "next/navigation";
import ProcessingScreen from "@/components/ProcessingScreen";

export default function ProcessingPage({
  searchParams,
}: {
  searchParams: { jobId?: string };
}) {
  if (!searchParams.jobId) redirect("/");
  return <ProcessingScreen jobId={searchParams.jobId} />;
}

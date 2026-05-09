import { redirect } from "next/navigation";
import ProcessingScreen, {
  type ProcessingType,
} from "@/components/ProcessingScreen";

const ALLOWED_TYPES: ProcessingType[] = ["student", "faculty", "provost"];

export default function ProcessingPage({
  searchParams,
}: {
  searchParams: { jobId?: string; type?: string };
}) {
  if (!searchParams.jobId) redirect("/");
  const t = (searchParams.type ?? "student") as ProcessingType;
  const type: ProcessingType = ALLOWED_TYPES.includes(t) ? t : "student";
  return <ProcessingScreen jobId={searchParams.jobId} type={type} />;
}

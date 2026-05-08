import StudyDashboard from "@/components/StudyDashboard";

export default function StudyPage({ params }: { params: { jobId: string } }) {
  return <StudyDashboard jobId={params.jobId} />;
}

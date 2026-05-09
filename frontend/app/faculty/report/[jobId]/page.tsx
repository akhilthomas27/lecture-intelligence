import FacultyReport from "@/components/FacultyReport";

export default function FacultyReportPage({
  params,
}: {
  params: { jobId: string };
}) {
  return <FacultyReport jobId={params.jobId} />;
}

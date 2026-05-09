import ProvostReport from "@/components/ProvostReport";

export default function ProvostReportPage({
  params,
}: {
  params: { jobId: string };
}) {
  return <ProvostReport jobId={params.jobId} />;
}

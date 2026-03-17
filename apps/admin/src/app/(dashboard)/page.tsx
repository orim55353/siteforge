import { prisma } from "@/lib/prisma";
import { PIPELINE_STAGES, STATUS_LABELS } from "@/lib/constants";
import { PipelineLive } from "@/components/pipeline-live";

export const dynamic = "force-dynamic";

async function getPipelineCounts() {
  const businesses = await prisma.business.groupBy({
    by: ["status"],
    _count: { id: true },
  });

  const counts: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) {
    counts[stage] = 0;
  }
  for (const row of businesses) {
    counts[row.status] = row._count.id;
  }
  return counts;
}

async function getAllBusinesses() {
  return prisma.business.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      city: true,
      state: true,
      score: true,
      googleRating: true,
      reviewCount: true,
      phone: true,
      updatedAt: true,
      market: { select: { industry: true } },
      previewPages: { select: { htmlUrl: true }, orderBy: { createdAt: "desc" }, take: 1 },
      intentPages: { select: { deployedUrl: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export default async function PipelinePage() {
  const [counts, allBusinesses] = await Promise.all([
    getPipelineCounts(),
    getAllBusinesses(),
  ]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-semibold">Pipeline Overview</h2>

      {/* Status cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Total</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        {PIPELINE_STAGES.map((stage) => (
          <div
            key={stage}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <p className="text-sm text-gray-500">{STATUS_LABELS[stage]}</p>
            <p className="text-2xl font-bold">{counts[stage]}</p>
          </div>
        ))}
      </div>

      {/* All businesses with live updates */}
      <h3 className="mb-3 text-lg font-medium">All Businesses</h3>
      <PipelineLive initialBusinesses={allBusinesses} />
    </div>
  );
}

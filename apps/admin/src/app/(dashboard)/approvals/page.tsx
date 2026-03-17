import { prisma } from "@/lib/prisma";
import { ApprovalTable } from "@/components/approval-table";

export const dynamic = "force-dynamic";

async function getQualifiedBusinesses() {
  return prisma.business.findMany({
    where: { status: "qualified", approvedAt: null },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      website: true,
      city: true,
      state: true,
      score: true,
      googleRating: true,
      reviewCount: true,
      createdAt: true,
      market: { select: { industry: true, name: true } },
    },
  });
}

export default async function ApprovalsPage() {
  const businesses = await getQualifiedBusinesses();

  return (
    <div>
      <h2 className="mb-2 text-2xl font-semibold">Approval Gate</h2>
      <p className="mb-6 text-sm text-gray-500">
        {businesses.length} qualified businesses pending page generation
        approval
      </p>
      <ApprovalTable businesses={businesses} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { SuppressionManager } from "@/components/suppression-manager";

export const dynamic = "force-dynamic";

async function getSuppressionEntries(page: number, pageSize: number) {
  const [entries, total] = await Promise.all([
    prisma.suppressionEntry.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.suppressionEntry.count(),
  ]);
  return { entries, total };
}

export default async function SuppressionPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const pageSize = 25;

  const { entries, total } = await getSuppressionEntries(page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <h2 className="mb-2 text-2xl font-semibold">Suppression List</h2>
      <p className="mb-6 text-sm text-gray-500">
        {total} suppressed email addresses
      </p>
      <SuppressionManager
        entries={entries}
        page={page}
        totalPages={totalPages}
      />
    </div>
  );
}

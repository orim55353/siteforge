import { prisma } from "@/lib/prisma";
import { MarketsTable } from "@/components/markets-table";

export const dynamic = "force-dynamic";

async function getMarkets() {
  const markets = await prisma.market.findMany({
    orderBy: [{ active: "desc" }, { opportunityScore: "desc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { businesses: true } },
    },
  });

  // Fetch per-market business status counts and last scan dates in parallel
  const [statusCounts, scans] = await Promise.all([
    prisma.business.groupBy({
      by: ["marketId", "status"],
      _count: true,
    }),
    prisma.marketScan.findMany({
      select: { industry: true, city: true, state: true, scannedAt: true },
      orderBy: { scannedAt: "desc" },
    }),
  ]);

  // Build lookup maps
  const qualifiedByMarket = new Map<string, number>();
  const deployedByMarket = new Map<string, number>();
  for (const row of statusCounts) {
    const current = qualifiedByMarket.get(row.marketId) ?? 0;
    const deployed = deployedByMarket.get(row.marketId) ?? 0;
    if (["qualified", "page_generated", "page_deployed", "outreach_scheduled", "outreach_sent", "replied", "converted"].includes(row.status)) {
      qualifiedByMarket.set(row.marketId, current + row._count);
    }
    if (["page_deployed", "outreach_scheduled", "outreach_sent", "replied", "converted"].includes(row.status)) {
      deployedByMarket.set(row.marketId, deployed + row._count);
    }
  }

  // Last scan by market key
  const scanByKey = new Map<string, { scannedAt: Date; count: number }>();
  for (const s of scans) {
    const key = `${s.industry}|${s.city}|${s.state}`;
    const existing = scanByKey.get(key);
    if (!existing) {
      scanByKey.set(key, { scannedAt: s.scannedAt, count: 1 });
    } else {
      scanByKey.set(key, { ...existing, count: existing.count + 1 });
    }
  }

  return markets.map((m) => {
    const scanKey = `${m.industry}|${m.city}|${m.state}`;
    const scan = scanByKey.get(scanKey);
    return {
      id: m.id,
      name: m.name,
      industry: m.industry,
      city: m.city,
      state: m.state,
      active: m.active,
      opportunityScore: m.opportunityScore,
      marketSize: m.marketSize,
      digitalGap: m.digitalGap,
      notes: m.notes,
      sourceFile: m.sourceFile,
      businessCount: m._count.businesses,
      qualifiedCount: qualifiedByMarket.get(m.id) ?? 0,
      deployedCount: deployedByMarket.get(m.id) ?? 0,
      scanCount: scan?.count ?? 0,
      lastScannedAt: scan?.scannedAt ?? null,
      createdAt: m.createdAt,
    };
  });
}

export default async function MarketsPage() {
  const markets = await getMarkets();

  return (
    <div>
      <h2 className="mb-2 text-2xl font-semibold">Markets</h2>
      <p className="mb-6 text-sm text-gray-500">
        Manage target industries and locations for lead discovery
      </p>
      <MarketsTable markets={markets} />
    </div>
  );
}

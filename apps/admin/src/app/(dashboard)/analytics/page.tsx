import { prisma } from "@/lib/prisma";
import { PageAnalyticsTable } from "@/components/page-analytics-table";

export const dynamic = "force-dynamic";

interface PageStats {
  slug: string;
  totalViews: number;
  uniqueVisitors: number;
  topCountries: Array<{ country: string; count: number }>;
  topCities: Array<{ city: string; region: string | null; count: number }>;
  devices: { mobile: number; tablet: number; desktop: number };
  lastViewedAt: Date | null;
  businessName: string | null;
}

async function getPageAnalytics(): Promise<PageStats[]> {
  // Get all page views grouped by slug
  const slugStats = await prisma.pageView.groupBy({
    by: ["slug"],
    _count: { id: true },
    _max: { viewedAt: true },
    orderBy: { _count: { id: "desc" } },
    take: 100,
  });

  if (slugStats.length === 0) return [];

  const slugs = slugStats.map((s) => s.slug);

  // Fetch unique visitors, geo breakdown, and device breakdown in parallel
  const [uniqueCounts, countryBreakdowns, cityBreakdowns, deviceBreakdowns, intentPages] =
    await Promise.all([
      // Unique visitors per slug
      Promise.all(
        slugs.map(async (slug) => {
          const result = await prisma.pageView.findMany({
            where: { slug, visitorHash: { not: null } },
            distinct: ["visitorHash"],
            select: { visitorHash: true },
          });
          return { slug, count: result.length };
        }),
      ),

      // Top countries per slug
      Promise.all(
        slugs.map(async (slug) => {
          const rows = await prisma.pageView.groupBy({
            by: ["country"],
            where: { slug, country: { not: null } },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 5,
          });
          return {
            slug,
            countries: rows.map((r) => ({
              country: r.country ?? "Unknown",
              count: r._count.id,
            })),
          };
        }),
      ),

      // Top cities per slug
      Promise.all(
        slugs.map(async (slug) => {
          const rows = await prisma.pageView.groupBy({
            by: ["city", "region"],
            where: { slug, city: { not: null } },
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 5,
          });
          return {
            slug,
            cities: rows.map((r) => ({
              city: r.city ?? "Unknown",
              region: r.region,
              count: r._count.id,
            })),
          };
        }),
      ),

      // Device breakdown per slug
      Promise.all(
        slugs.map(async (slug) => {
          const rows = await prisma.pageView.groupBy({
            by: ["deviceType"],
            where: { slug },
            _count: { id: true },
          });
          const devices = { mobile: 0, tablet: 0, desktop: 0 };
          for (const row of rows) {
            const dt = row.deviceType as keyof typeof devices;
            if (dt in devices) {
              devices[dt] = row._count.id;
            }
          }
          return { slug, devices };
        }),
      ),

      // Map slugs to business names via intent pages
      prisma.intentPage.findMany({
        where: { slug: { in: slugs } },
        select: {
          slug: true,
          business: { select: { name: true } },
        },
      }),
    ]);

  const uniqueMap = new Map(uniqueCounts.map((u) => [u.slug, u.count]));
  const countryMap = new Map(countryBreakdowns.map((c) => [c.slug, c.countries]));
  const cityMap = new Map(cityBreakdowns.map((c) => [c.slug, c.cities]));
  const deviceMap = new Map(deviceBreakdowns.map((d) => [d.slug, d.devices]));
  const nameMap = new Map(intentPages.map((p) => [p.slug, p.business.name]));

  return slugStats.map((stat) => ({
    slug: stat.slug,
    totalViews: stat._count.id,
    uniqueVisitors: uniqueMap.get(stat.slug) ?? 0,
    topCountries: countryMap.get(stat.slug) ?? [],
    topCities: cityMap.get(stat.slug) ?? [],
    devices: deviceMap.get(stat.slug) ?? { mobile: 0, tablet: 0, desktop: 0 },
    lastViewedAt: stat._max.viewedAt,
    businessName: nameMap.get(stat.slug) ?? null,
  }));
}

async function getOverallStats() {
  const [totalViews, uniqueVisitors, viewsToday] = await Promise.all([
    prisma.pageView.count(),
    prisma.pageView
      .findMany({ distinct: ["visitorHash"], select: { visitorHash: true } })
      .then((rows) => rows.length),
    prisma.pageView.count({
      where: {
        viewedAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),
  ]);

  return { totalViews, uniqueVisitors, viewsToday };
}

export default async function AnalyticsPage() {
  const [pages, overall] = await Promise.all([
    getPageAnalytics(),
    getOverallStats(),
  ]);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-semibold">Page Analytics</h2>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Total Page Views</p>
          <p className="text-2xl font-bold">{overall.totalViews.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Unique Visitors</p>
          <p className="text-2xl font-bold">{overall.uniqueVisitors.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Views Today</p>
          <p className="text-2xl font-bold">{overall.viewsToday.toLocaleString()}</p>
        </div>
      </div>

      {pages.length === 0 ? (
        <p className="text-gray-500">No page views recorded yet.</p>
      ) : (
        <PageAnalyticsTable pages={pages} />
      )}
    </div>
  );
}

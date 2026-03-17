import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type TopBusiness = {
  name: string;
  rating: number;
  reviews: number;
  hasWebsite?: boolean;
};

async function getMarketScans() {
  return prisma.marketScan.findMany({
    orderBy: { scannedAt: "desc" },
  });
}

export default async function DiscoveryPage() {
  const scans = await getMarketScans();

  return (
    <div>
      <h2 className="mb-2 text-2xl font-semibold">Discovery Scans</h2>
      <p className="mb-6 text-sm text-gray-500">
        Market scan results from SerpAPI discovery runs
      </p>

      {scans.length === 0 ? (
        <p className="text-sm text-gray-400">No market scans yet</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {scans.map((scan) => {
            const topBusinesses = (scan.topBusinesses as TopBusiness[]) ?? [];
            const qualifyRate =
              scan.totalResults > 0
                ? ((scan.qualifying / scan.totalResults) * 100).toFixed(0)
                : "0";

            return (
              <div
                key={scan.id}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {scan.industry}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {scan.city}, {scan.state}
                    </p>
                  </div>
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                    {scan.qualifying} qualifying
                  </span>
                </div>

                {/* Stats grid */}
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <StatBox label="Total Found" value={scan.totalResults} />
                  <StatBox label="With Website" value={scan.withWebsite} />
                  <StatBox label="No Website" value={scan.withoutWebsite} />
                  <StatBox
                    label="Avg Rating"
                    value={scan.avgRating.toFixed(1)}
                  />
                  <StatBox
                    label="Avg Reviews"
                    value={Math.round(scan.avgReviews)}
                  />
                  <StatBox label="Qualify Rate" value={`${qualifyRate}%`} />
                </div>

                {/* Qualifying breakdown bar */}
                {scan.totalResults > 0 && (
                  <div className="mb-4">
                    <div className="mb-1 flex justify-between text-xs text-gray-400">
                      <span>
                        No website ({scan.withoutWebsite})
                      </span>
                      <span>
                        Has website ({scan.withWebsite})
                      </span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="bg-emerald-500"
                        style={{
                          width: `${(scan.qualifying / scan.totalResults) * 100}%`,
                        }}
                        title={`${scan.qualifying} qualifying`}
                      />
                      <div
                        className="bg-amber-400"
                        style={{
                          width: `${((scan.withoutWebsite - scan.qualifying) / scan.totalResults) * 100}%`,
                        }}
                        title={`${scan.withoutWebsite - scan.qualifying} no website but don't qualify`}
                      />
                      <div
                        className="bg-gray-400"
                        style={{
                          width: `${(scan.withWebsite / scan.totalResults) * 100}%`,
                        }}
                        title={`${scan.withWebsite} with website`}
                      />
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        Qualifying
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                        No website (low score)
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                        Has website
                      </span>
                    </div>
                  </div>
                )}

                {/* Top qualifying businesses */}
                {topBusinesses.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                      Top Qualifying Businesses
                    </p>
                    <div className="space-y-1.5">
                      {topBusinesses.map((biz, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-1.5 text-sm"
                        >
                          <span className="text-gray-700">{biz.name}</span>
                          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-0.5">
                              <svg
                                className="h-3 w-3 text-yellow-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                              {biz.rating.toFixed(1)}
                            </span>
                            <span>{biz.reviews} reviews</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <p className="mt-3 text-xs text-gray-400">
                  Scanned {new Date(scan.scannedAt).toLocaleString()} &middot;
                  Query: &ldquo;{scan.query}&rdquo;
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2 text-center">
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

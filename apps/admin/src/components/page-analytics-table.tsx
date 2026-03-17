"use client";

import { useState } from "react";

interface PageStats {
  slug: string;
  totalViews: number;
  uniqueVisitors: number;
  topCountries: Array<{ country: string; count: number }>;
  topCities: Array<{ city: string; region: string | null; count: number }>;
  devices: { mobile: number; tablet: number; desktop: number };
  lastViewedAt: Date | string | null;
  businessName: string | null;
}

function DeviceBar({ devices }: { devices: PageStats["devices"] }) {
  const total = devices.mobile + devices.tablet + devices.desktop;
  if (total === 0) return <span className="text-gray-400">-</span>;

  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex h-2 w-24 overflow-hidden rounded-full bg-gray-100">
        {devices.desktop > 0 && (
          <div
            className="bg-blue-500"
            style={{ width: `${pct(devices.desktop)}%` }}
          />
        )}
        {devices.mobile > 0 && (
          <div
            className="bg-emerald-500"
            style={{ width: `${pct(devices.mobile)}%` }}
          />
        )}
        {devices.tablet > 0 && (
          <div
            className="bg-amber-500"
            style={{ width: `${pct(devices.tablet)}%` }}
          />
        )}
      </div>
      <span className="text-gray-500">
        {pct(devices.desktop)}% / {pct(devices.mobile)}% / {pct(devices.tablet)}%
      </span>
    </div>
  );
}

function formatDate(date: Date | string | null): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PageAnalyticsTable({ pages }: { pages: PageStats[] }) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-600">Page</th>
            <th className="px-4 py-3 font-medium text-gray-600 text-right">Views</th>
            <th className="px-4 py-3 font-medium text-gray-600 text-right">Unique</th>
            <th className="px-4 py-3 font-medium text-gray-600">Top Location</th>
            <th className="px-4 py-3 font-medium text-gray-600">
              <span title="Desktop / Mobile / Tablet">Devices</span>
            </th>
            <th className="px-4 py-3 font-medium text-gray-600">Last View</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {pages.map((page) => {
            const isExpanded = expandedSlug === page.slug;
            const topCity = page.topCities[0];
            const topCountry = page.topCountries[0];
            const locationLabel = topCity
              ? `${topCity.city}${topCity.region ? `, ${topCity.region}` : ""}`
              : topCountry
                ? topCountry.country
                : "-";

            return (
              <tr key={page.slug} className="group">
                <td className="px-4 py-3">
                  <button
                    onClick={() =>
                      setExpandedSlug(isExpanded ? null : page.slug)
                    }
                    className="text-left"
                  >
                    <span className="font-medium text-gray-900">
                      {page.businessName ?? page.slug}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      /{page.slug}
                    </span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-3 grid grid-cols-2 gap-4 rounded-md bg-gray-50 p-3 text-xs">
                      <div>
                        <p className="mb-1 font-semibold text-gray-600">
                          Top Countries
                        </p>
                        {page.topCountries.length === 0 ? (
                          <p className="text-gray-400">No data</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {page.topCountries.map((c) => (
                              <li
                                key={c.country}
                                className="flex justify-between"
                              >
                                <span>{c.country}</span>
                                <span className="text-gray-500">
                                  {c.count}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 font-semibold text-gray-600">
                          Top Cities
                        </p>
                        {page.topCities.length === 0 ? (
                          <p className="text-gray-400">No data</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {page.topCities.map((c) => (
                              <li
                                key={`${c.city}-${c.region}`}
                                className="flex justify-between"
                              >
                                <span>
                                  {c.city}
                                  {c.region ? `, ${c.region}` : ""}
                                </span>
                                <span className="text-gray-500">
                                  {c.count}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {page.totalViews.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {page.uniqueVisitors.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-600">{locationLabel}</td>
                <td className="px-4 py-3">
                  <DeviceBar devices={page.devices} />
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {formatDate(page.lastViewedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

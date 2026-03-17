"use client";

import { useState, useTransition } from "react";
import { addMarket, toggleMarketActive, deleteMarket } from "@/app/(dashboard)/markets/actions";

interface MarketRow {
  id: string;
  name: string;
  industry: string;
  city: string;
  state: string;
  active: boolean;
  opportunityScore: number | null;
  marketSize: string | null;
  digitalGap: string | null;
  notes: string | null;
  sourceFile: string | null;
  businessCount: number;
  qualifiedCount: number;
  deployedCount: number;
  scanCount: number;
  lastScannedAt: Date | null;
  createdAt: Date;
}

export function MarketsTable({ markets }: { markets: MarketRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const filtered = markets.filter((m) => {
    if (filter === "active") return m.active;
    if (filter === "inactive") return !m.active;
    return true;
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!industry.trim() || !city.trim() || !state.trim()) return;
    startTransition(async () => {
      await addMarket(industry, city, state);
      setIndustry("");
      setCity("");
      setState("");
    });
  }

  function handleToggle(id: string, active: boolean) {
    startTransition(() => toggleMarketActive(id, !active));
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? If it has businesses, it will be deactivated instead.`)) return;
    startTransition(() => deleteMarket(id));
  }

  const activeCount = markets.filter((m) => m.active).length;
  const totalBusinesses = markets.reduce((sum, m) => sum + m.businessCount, 0);
  const totalQualified = markets.reduce((sum, m) => sum + m.qualifiedCount, 0);
  const totalDeployed = markets.reduce((sum, m) => sum + m.deployedCount, 0);

  return (
    <div>
      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total Markets" value={markets.length} sub={`${activeCount} active`} />
        <SummaryCard label="Businesses" value={totalBusinesses} sub="discovered" />
        <SummaryCard label="Qualified" value={totalQualified} sub="ready for pages" />
        <SummaryCard label="Deployed" value={totalDeployed} sub="pages live" />
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-6 flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Industry</label>
          <input
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. barber shop"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">City</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Miami"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">State</label>
          <input
            type="text"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="e.g. FL"
            maxLength={2}
            className="w-16 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add Market"}
        </button>
      </form>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        {(["all", "active", "inactive"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "all" && ` (${markets.length})`}
            {f === "active" && ` (${activeCount})`}
            {f === "inactive" && ` (${markets.length - activeCount})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <Th>Market</Th>
              <Th>Status</Th>
              <Th align="right">Businesses</Th>
              <Th align="right">Qualified</Th>
              <Th align="right">Deployed</Th>
              <Th align="right">Opportunity</Th>
              <Th>Last Scanned</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                  No markets found
                </td>
              </tr>
            ) : (
              filtered.map((market) => (
                <tr key={market.id} className={`hover:bg-gray-50 ${!market.active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {market.industry.charAt(0).toUpperCase() + market.industry.slice(1)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {market.city}, {market.state}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        market.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {market.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">
                    {market.businessCount}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">
                    {market.qualifiedCount > 0 ? (
                      <span className="font-medium text-emerald-600">{market.qualifiedCount}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">
                    {market.deployedCount > 0 ? (
                      <span className="font-medium text-indigo-600">{market.deployedCount}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {market.opportunityScore != null ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className={`h-full rounded-full ${
                              market.opportunityScore >= 80
                                ? "bg-emerald-500"
                                : market.opportunityScore >= 60
                                  ? "bg-amber-400"
                                  : "bg-gray-400"
                            }`}
                            style={{ width: `${market.opportunityScore}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{market.opportunityScore}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {market.lastScannedAt ? (
                      <span title={new Date(market.lastScannedAt).toLocaleString()}>
                        {formatRelative(market.lastScannedAt)}
                      </span>
                    ) : (
                      <span className="text-gray-400">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggle(market.id, market.active)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                        title={market.active ? "Deactivate" : "Activate"}
                      >
                        {market.active ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => handleDelete(market.id, market.name)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString();
}

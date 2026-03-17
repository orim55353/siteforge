"use client";

import { useState, useTransition } from "react";
import { approveBusinesses, rejectBusinesses } from "@/app/(dashboard)/approvals/actions";

type Business = {
  id: string;
  name: string;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  score: number | null;
  googleRating: number | null;
  reviewCount: number | null;
  createdAt: Date;
  market: { industry: string; name: string };
};

export function ApprovalTable({ businesses }: { businesses: Business[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const toggleAll = () => {
    if (selected.size === businesses.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(businesses.map((b) => b.id)));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleApprove = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      await approveBusinesses(ids);
      setSelected(new Set());
    });
  };

  const handleReject = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      await rejectBusinesses(ids);
      setSelected(new Set());
    });
  };

  return (
    <div>
      {/* Bulk actions */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={selected.size === 0 || isPending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Processing..." : `Approve (${selected.size})`}
        </button>
        <button
          onClick={handleReject}
          disabled={selected.size === 0 || isPending}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject ({selected.size})
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={
                    businesses.length > 0 &&
                    selected.size === businesses.length
                  }
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Business
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Market
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Website
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Score
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Rating
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Reviews
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {businesses.map((b) => (
              <tr
                key={b.id}
                className={`cursor-pointer transition-colors ${
                  selected.has(b.id) ? "bg-emerald-50" : "hover:bg-gray-50"
                }`}
                onClick={() => toggle(b.id)}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={() => toggle(b.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                  <div>{b.name}</div>
                  <div className="text-xs text-gray-400">
                    {[b.city, b.state].filter(Boolean).join(", ")}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {b.market.industry}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {b.email ?? "—"}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-sm text-blue-600">
                  {b.website ? (
                    <a
                      href={b.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {b.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                  {b.score ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {b.googleRating?.toFixed(1) ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {b.reviewCount ?? 0}
                </td>
              </tr>
            ))}
            {businesses.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-sm text-gray-400"
                >
                  No businesses pending approval
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { BusinessStatusBadge } from "./status-badge";
import type { BusinessStatus } from "@lead-gen/db";

type BusinessRow = {
  id: string;
  name: string;
  status: BusinessStatus;
  city: string | null;
  state: string | null;
  score: number | null;
  googleRating: number | null;
  reviewCount: number | null;
  phone: string | null;
  updatedAt: Date;
  market: { industry: string };
  previewPages: { htmlUrl: string | null }[];
  intentPages: { deployedUrl: string }[];
};

type SortKey = "name" | "industry" | "location" | "rating" | "score" | "status" | "updated";
type SortDir = "asc" | "desc";

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" && typeof b === "string") {
    const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  }
  const diff = (a as number) - (b as number);
  return dir === "asc" ? diff : -diff;
}

function sortBusinesses(rows: BusinessRow[], key: SortKey, dir: SortDir): BusinessRow[] {
  return [...rows].sort((a, b) => {
    switch (key) {
      case "name":
        return compareValues(a.name, b.name, dir);
      case "industry":
        return compareValues(a.market.industry, b.market.industry, dir);
      case "location":
        return compareValues(
          [a.city, a.state].filter(Boolean).join(", "),
          [b.city, b.state].filter(Boolean).join(", "),
          dir
        );
      case "rating":
        return compareValues(a.googleRating, b.googleRating, dir);
      case "score":
        return compareValues(a.score, b.score, dir);
      case "status":
        return compareValues(a.status, b.status, dir);
      case "updated":
        return compareValues(
          new Date(a.updatedAt).getTime(),
          new Date(b.updatedAt).getTime(),
          dir
        );
      default:
        return 0;
    }
  });
}

export function PipelineLive({
  initialBusinesses,
}: {
  initialBusinesses: BusinessRow[];
}) {
  const [businesses, setBusinesses] = useState(initialBusinesses);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  const sortedBusinesses = useMemo(
    () => sortBusinesses(businesses, sortKey, sortDir),
    [businesses, sortKey, sortDir]
  );

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    const channel = supabase
      .channel("businesses-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "businesses" },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          setBusinesses((prev) =>
            prev.map((b) =>
              b.id === updated.id
                ? {
                    ...b,
                    status: updated.status as BusinessStatus,
                    score: updated.score as number | null,
                    googleRating: updated.google_rating as number | null,
                    reviewCount: updated.review_count as number | null,
                    updatedAt: new Date(updated.updated_at as string),
                  }
                : b
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "businesses" },
        (payload) => {
          const inserted = payload.new as Record<string, unknown>;
          const newBusiness: BusinessRow = {
            id: inserted.id as string,
            name: inserted.name as string,
            status: inserted.status as BusinessStatus,
            city: inserted.city as string | null,
            state: inserted.state as string | null,
            score: inserted.score as number | null,
            googleRating: inserted.google_rating as number | null,
            reviewCount: inserted.review_count as number | null,
            phone: inserted.phone as string | null,
            updatedAt: new Date(inserted.updated_at as string),
            market: { industry: "" },
            previewPages: [],
            intentPages: [],
          };
          setBusinesses((prev) => [newBusiness, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <SortTh sortKey="name" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Business</SortTh>
            <SortTh sortKey="industry" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Industry</SortTh>
            <SortTh sortKey="location" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Location</SortTh>
            <SortTh sortKey="rating" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Rating</SortTh>
            <SortTh sortKey="score" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Score</SortTh>
            <SortTh sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Status</SortTh>
            <Th>Page</Th>
            <SortTh sortKey="updated" currentKey={sortKey} dir={sortDir} onSort={handleSort}>Updated</SortTh>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {sortedBusinesses.map((b) => {
            const pageUrl =
              b.intentPages[0]?.deployedUrl ??
              b.previewPages[0]?.htmlUrl ??
              null;

            return (
              <tr key={b.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium">
                  <Link
                    href={`/business/${b.id}`}
                    className="text-indigo-600 hover:text-indigo-800"
                  >
                    {b.name}
                  </Link>
                  {b.phone && (
                    <span className="ml-2 text-xs text-gray-400">{b.phone}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {b.market.industry}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {[b.city, b.state].filter(Boolean).join(", ")}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {b.googleRating != null ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="font-medium text-yellow-600">
                        {b.googleRating.toFixed(1)}
                      </span>
                      <svg
                        className="h-3.5 w-3.5 text-yellow-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      {b.reviewCount != null && (
                        <span className="text-xs text-gray-400">
                          ({b.reviewCount})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {b.score ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <BusinessStatusBadge status={b.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {pageUrl ? (
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800"
                    >
                      View &rarr;
                    </a>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {new Date(b.updatedAt).toLocaleString()}
                </td>
              </tr>
            );
          })}
          {businesses.length === 0 && (
            <tr>
              <td
                colSpan={8}
                className="px-4 py-8 text-center text-sm text-gray-400"
              >
                No businesses yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
      {children}
    </th>
  );
}

function SortTh({
  children,
  sortKey,
  currentKey,
  dir,
  onSort,
}: {
  children: React.ReactNode;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === currentKey;
  return (
    <th
      className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span className={isActive ? "text-indigo-600" : "text-gray-300"}>
          {isActive && dir === "asc" ? "\u2191" : isActive && dir === "desc" ? "\u2193" : "\u2195"}
        </span>
      </span>
    </th>
  );
}

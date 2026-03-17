"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  addSuppression,
  removeSuppression,
} from "@/app/(dashboard)/suppression/actions";

type Entry = {
  id: string;
  email: string;
  reason: string;
  source: string | null;
  createdAt: Date;
};

export function SuppressionManager({
  entries,
  page,
  totalPages,
}: {
  entries: Entry[];
  page: number;
  totalPages: number;
}) {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("manual");
  const [isPending, startTransition] = useTransition();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    startTransition(async () => {
      await addSuppression(trimmed, reason);
      setEmail("");
    });
  };

  const handleRemove = (id: string) => {
    startTransition(async () => {
      await removeSuppression(id);
    });
  };

  return (
    <div>
      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-6 flex items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Reason
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="manual">Manual</option>
            <option value="bounced">Bounced</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="complained">Complained</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add"}
        </button>
      </form>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Reason
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Source
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Added
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                  {entry.email}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      entry.reason === "manual"
                        ? "bg-gray-100 text-gray-700"
                        : entry.reason === "bounced"
                          ? "bg-red-100 text-red-700"
                          : entry.reason === "complained"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {entry.reason}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {entry.source ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    onClick={() => handleRemove(entry.id)}
                    disabled={isPending}
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-gray-400"
                >
                  No suppressed emails
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/suppression?page=${page - 1}`}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/suppression?page=${page + 1}`}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

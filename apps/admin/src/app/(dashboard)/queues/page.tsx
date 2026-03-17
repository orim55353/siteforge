import { Queue } from "bullmq";
import Redis from "ioredis";

export const dynamic = "force-dynamic";

const QUEUE_NAMES = [
  { name: "discovery", label: "Discovery" },
  { name: "enrichment", label: "Enrichment" },
  { name: "scoring", label: "Scoring" },
  { name: "page-gen", label: "Page Gen" },
  { name: "deploy", label: "Deploy" },
  { name: "scheduler", label: "Scheduler" },
  { name: "email", label: "Email" },
  { name: "reply-ingestion", label: "Reply Ingestion" },
] as const;

interface QueueStats {
  name: string;
  label: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

async function getQueueStats(): Promise<QueueStats[]> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  // Use a single shared ioredis connection for all queues
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  await connection.connect();

  try {
    const stats = await Promise.all(
      QUEUE_NAMES.map(async ({ name, label }) => {
        const queue = new Queue(name, { connection });
        try {
          const counts = await queue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed",
            "delayed",
            "paused",
          );
          return {
            name,
            label,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            paused: counts.paused ?? 0,
          };
        } finally {
          await queue.close();
        }
      }),
    );
    return stats;
  } finally {
    await connection.quit();
  }
}

function StatusBadge({ count, variant }: { count: number; variant: string }) {
  if (count === 0) return <span className="text-gray-300">0</span>;

  const colors: Record<string, string> = {
    waiting: "bg-yellow-100 text-yellow-800",
    active: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    delayed: "bg-purple-100 text-purple-800",
    paused: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={`inline-block min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs font-medium ${colors[variant] ?? "bg-gray-100 text-gray-800"}`}
    >
      {count.toLocaleString()}
    </span>
  );
}

export default async function QueuesPage() {
  let stats: QueueStats[];
  let error: string | null = null;

  try {
    stats = await getQueueStats();
  } catch (err) {
    stats = [];
    error =
      err instanceof Error ? err.message : "Failed to connect to Redis";
  }

  const totalActive = stats.reduce((sum, q) => sum + q.active, 0);
  const totalWaiting = stats.reduce((sum, q) => sum + q.waiting, 0);
  const totalFailed = stats.reduce((sum, q) => sum + q.failed, 0);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-semibold">Job Queues</h2>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Active Jobs</p>
          <p className="text-2xl font-bold text-blue-600">
            {totalActive.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Waiting</p>
          <p className="text-2xl font-bold text-yellow-600">
            {totalWaiting.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Failed</p>
          <p className="text-2xl font-bold text-red-600">
            {totalFailed.toLocaleString()}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not connect to Redis: {error}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-700">Queue</th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  Waiting
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  Active
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  Completed
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  Failed
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  Delayed
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  Paused
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.map((q) => (
                <tr key={q.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {q.label}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge count={q.waiting} variant="waiting" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge count={q.active} variant="active" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge count={q.completed} variant="completed" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge count={q.failed} variant="failed" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge count={q.delayed} variant="delayed" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge count={q.paused} variant="paused" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Refresh the page to update stats.
      </p>
    </div>
  );
}

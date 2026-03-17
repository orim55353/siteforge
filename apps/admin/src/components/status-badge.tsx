import type { BusinessStatus, OutreachMessageStatus } from "@lead-gen/db";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/constants";

const OUTREACH_STATUS_COLORS: Record<OutreachMessageStatus, string> = {
  scheduled: "bg-gray-100 text-gray-700",
  sent: "bg-indigo-100 text-indigo-700",
  delivered: "bg-blue-100 text-blue-700",
  opened: "bg-emerald-100 text-emerald-700",
  clicked: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  complained: "bg-rose-100 text-rose-700",
};

export function BusinessStatusBadge({ status }: { status: BusinessStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function OutreachStatusBadge({
  status,
}: {
  status: OutreachMessageStatus;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${OUTREACH_STATUS_COLORS[status]}`}
    >
      {status}
    </span>
  );
}

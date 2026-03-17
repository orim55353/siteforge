import Link from "next/link";
import { OutreachStatusBadge } from "./status-badge";
import type { OutreachMessageStatus, EmailEventType } from "@lead-gen/db";

type Message = {
  id: string;
  toEmail: string;
  subject: string;
  status: OutreachMessageStatus;
  scheduledFor: Date;
  sentAt: Date | null;
  createdAt: Date;
  business: { id: string; name: string };
  campaign: { name: string };
  emailEvents: { type: EmailEventType; occurredAt: Date }[];
  replies: { id: string; createdAt: Date }[];
};

function EventIndicators({
  events,
  hasReply,
}: {
  events: { type: EmailEventType }[];
  hasReply: boolean;
}) {
  const types = new Set(events.map((e) => e.type));
  return (
    <div className="flex items-center gap-1.5">
      {types.has("delivered") && (
        <span className="text-xs text-blue-500" title="Delivered">
          D
        </span>
      )}
      {types.has("opened") && (
        <span className="text-xs text-emerald-500" title="Opened">
          O
        </span>
      )}
      {types.has("clicked") && (
        <span className="text-xs text-green-600" title="Clicked">
          C
        </span>
      )}
      {types.has("bounced") && (
        <span className="text-xs text-red-500" title="Bounced">
          B
        </span>
      )}
      {hasReply && (
        <span className="text-xs font-semibold text-purple-600" title="Replied">
          R
        </span>
      )}
    </div>
  );
}

export function OutreachTable({
  messages,
  page,
  totalPages,
}: {
  messages: Message[];
  page: number;
  totalPages: number;
}) {
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Business
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                To
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Subject
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Campaign
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Events
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Sent
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {messages.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                  {m.business.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {m.toEmail}
                </td>
                <td className="max-w-[250px] truncate px-4 py-3 text-sm text-gray-700">
                  {m.subject}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {m.campaign.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <OutreachStatusBadge status={m.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <EventIndicators
                    events={m.emailEvents}
                    hasReply={m.replies.length > 0}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {m.sentAt
                    ? new Date(m.sentAt).toLocaleString()
                    : new Date(m.scheduledFor).toLocaleString() + " (sched.)"}
                </td>
              </tr>
            ))}
            {messages.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-gray-400"
                >
                  No outreach messages yet
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
                href={`/outreach?page=${page - 1}`}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/outreach?page=${page + 1}`}
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

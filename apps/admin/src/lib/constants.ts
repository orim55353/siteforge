import type { BusinessStatus } from "@lead-gen/db";

export const PIPELINE_STAGES: readonly BusinessStatus[] = [
  "discovered",
  "enriched",
  "qualified",
  "disqualified",
  "page_generated",
  "page_deployed",
  "outreach_scheduled",
  "outreach_sent",
  "replied",
  "no_reply",
  "bounced",
  "unsubscribed",
  "converted",
] as const;

export const STATUS_COLORS: Record<BusinessStatus, string> = {
  discovered: "bg-gray-100 text-gray-700",
  enriched: "bg-blue-100 text-blue-700",
  qualified: "bg-emerald-100 text-emerald-700",
  disqualified: "bg-red-100 text-red-700",
  page_generated: "bg-violet-100 text-violet-700",
  page_deployed: "bg-purple-100 text-purple-700",
  outreach_scheduled: "bg-amber-100 text-amber-700",
  outreach_sent: "bg-indigo-100 text-indigo-700",
  replied: "bg-green-100 text-green-700",
  no_reply: "bg-orange-100 text-orange-700",
  bounced: "bg-red-100 text-red-700",
  unsubscribed: "bg-rose-100 text-rose-700",
  converted: "bg-teal-100 text-teal-700",
};

export const STATUS_LABELS: Record<BusinessStatus, string> = {
  discovered: "Discovered",
  enriched: "Enriched",
  qualified: "Qualified",
  disqualified: "Disqualified",
  page_generated: "Page Generated",
  page_deployed: "Page Deployed",
  outreach_scheduled: "Outreach Scheduled",
  outreach_sent: "Outreach Sent",
  replied: "Replied",
  no_reply: "No Reply",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  converted: "Converted",
};

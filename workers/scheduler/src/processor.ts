import type { SchedulerJobData, SchedulerJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { getNextSendWindow } from "./send-window.js";

/**
 * Schedule outreach for a business.
 * Creates an outreach_messages row with a future scheduledFor time.
 * The sendDueOutreach Cloud Function (triggered by Cloud Scheduler) will
 * pick it up and send it when the time arrives.
 */
export async function processSchedulerJob(
  data: SchedulerJobData,
): Promise<SchedulerJobResult> {
  const { businessId, campaignId, sendAt } = data;

  // ── Load business + campaign ──
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  if (business.status !== "page_deployed") {
    throw new Error(
      `Business ${businessId} status is "${business.status}", expected "page_deployed"`,
    );
  }

  if (!business.email) {
    throw new Error(`Business ${businessId} has no email address`);
  }

  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
  });

  console.log(`[scheduler] Scheduling outreach for: ${business.name} (${business.email})`);

  // ── Calculate send time ──
  const timezone = business.timezone ?? "America/Chicago";
  const scheduledFor = sendAt
    ? new Date(sendAt)
    : getNextSendWindow(timezone);

  console.log(
    `[scheduler] Send window: ${scheduledFor.toISOString()} (tz: ${timezone})`,
  );

  // ── Render email subject + body from campaign templates ──
  const subject = renderTemplate(campaign.subjectLine, business);
  const bodyHtml = renderTemplate(campaign.bodyTemplate, business);

  const fromEmail = process.env.FROM_EMAIL ?? "hello@yourdomain.com";

  // ── Create outreach_messages row ──
  const outreachMessage = await prisma.outreachMessage.create({
    data: {
      businessId,
      campaignId,
      status: "scheduled",
      toEmail: business.email,
      fromEmail,
      subject,
      bodyHtml,
      scheduledFor,
    },
  });

  console.log(`[scheduler] Outreach message created: ${outreachMessage.id}`);

  // ── Update business status ──
  await prisma.business.update({
    where: { id: businessId },
    data: { status: "outreach_scheduled" },
  });

  console.log(`[scheduler] Scheduled for ${scheduledFor.toISOString()}`);

  return {
    outreachMessageId: outreachMessage.id,
    scheduledFor: scheduledFor.toISOString(),
  };
}

/**
 * Simple template rendering — replaces {{field}} placeholders with
 * business data.
 */
function renderTemplate(
  template: string,
  business: { name: string; city?: string | null; state?: string | null; categories?: string[] },
): string {
  return template
    .replace(/\{\{business\.name\}\}/g, business.name)
    .replace(/\{\{business\.city\}\}/g, business.city ?? "")
    .replace(/\{\{business\.state\}\}/g, business.state ?? "")
    .replace(
      /\{\{business\.category\}\}/g,
      business.categories?.[0] ?? "",
    );
}

import type { Job } from "bullmq";
import type { SchedulerJobData, SchedulerJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { emailQueue } from "@lead-gen/queue";
import { getNextSendWindow } from "./send-window.js";

export async function processSchedulerJob(
  job: Job<SchedulerJobData, SchedulerJobResult>,
): Promise<SchedulerJobResult> {
  const { businessId, campaignId, sendAt } = job.data;

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

  await job.log(`Scheduling outreach for: ${business.name} (${business.email})`);

  // ── Calculate send time ──
  const timezone = business.timezone ?? "America/Chicago";
  const scheduledFor = sendAt
    ? new Date(sendAt)
    : getNextSendWindow(timezone);

  await job.log(
    `Send window: ${scheduledFor.toISOString()} (tz: ${timezone})`,
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

  await job.log(`Outreach message created: ${outreachMessage.id}`);

  // ── Update business status ──
  await prisma.business.update({
    where: { id: businessId },
    data: { status: "outreach_scheduled" },
  });

  // ── Enqueue delayed email job ──
  const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());
  await emailQueue.add(
    `email-${outreachMessage.id}`,
    { outreachMessageId: outreachMessage.id },
    { delay: delayMs },
  );

  await job.log(
    `Email job enqueued with ${Math.round(delayMs / 1000)}s delay`,
  );

  return {
    outreachMessageId: outreachMessage.id,
    scheduledFor: scheduledFor.toISOString(),
  };
}

/**
 * Simple template rendering — replaces {{field}} placeholders with
 * business data. For the MVP this handles the common fields;
 * the campaign body_template uses Handlebars syntax that we resolve here.
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

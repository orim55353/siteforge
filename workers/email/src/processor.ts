import type { EmailJobData, EmailJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const REPLY_TO_ADDRESS = process.env.REPLY_TO_ADDRESS ?? "replies@yourdomain.com";

export async function processEmailJob(
  data: EmailJobData,
): Promise<EmailJobResult> {
  const { outreachMessageId } = data;

  // ── Load outreach message with business ──
  const message = await prisma.outreachMessage.findUniqueOrThrow({
    where: { id: outreachMessageId },
    include: { business: true },
  });

  if (message.status !== "scheduled") {
    throw new Error(
      `OutreachMessage ${outreachMessageId} status is "${message.status}", expected "scheduled"`,
    );
  }

  console.log(`[email] Sending email to: ${message.toEmail}`);

  // ── Double-guard suppression check ──
  const suppressed = await prisma.suppressionEntry.findUnique({
    where: { email: message.toEmail },
  });

  if (suppressed) {
    console.log(
      `[email] SUPPRESSED: ${message.toEmail} (reason: ${suppressed.reason}). Skipping send.`,
    );
    throw new Error(
      `Email ${message.toEmail} is on suppression list (reason: ${suppressed.reason})`,
    );
  }

  // ── Send via Resend (with open + click tracking) ──
  const { data: sendData, error } = await resend.emails.send({
    from: message.fromEmail,
    to: message.toEmail,
    replyTo: REPLY_TO_ADDRESS,
    subject: message.subject,
    html: message.bodyHtml,
    headers: {
      "X-Outreach-Message-Id": outreachMessageId,
    },
  } as Parameters<typeof resend.emails.send>[0]);

  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }

  if (!sendData?.id) {
    throw new Error("Resend returned no message ID");
  }

  console.log(`[email] Sent via Resend. ID: ${sendData.id}`);

  // ── Update outreach message with Resend ID and sent status ──
  await prisma.outreachMessage.update({
    where: { id: outreachMessageId },
    data: {
      resendId: sendData.id,
      status: "sent",
      sentAt: new Date(),
    },
  });

  // ── Update business status to outreach_sent ──
  await prisma.business.update({
    where: { id: message.businessId },
    data: { status: "outreach_sent" },
  });

  console.log(`[email] Updated status to sent for message ${outreachMessageId}`);

  return { outreachMessageId, resendId: sendData.id };
}

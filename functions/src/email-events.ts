import type { Request, Response } from "express";
import type { EmailEventType, OutreachMessageStatus } from "@lead-gen/db";
import { prisma } from "@lead-gen/db";

const EVENT_TYPE_MAP: Record<string, EmailEventType | undefined> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

const STATUS_PRIORITY: Record<string, number> = {
  scheduled: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 5,
  complained: 6,
};

function shouldAdvanceStatus(
  current: OutreachMessageStatus,
  incoming: EmailEventType,
): boolean {
  return (STATUS_PRIORITY[incoming] ?? 0) > (STATUS_PRIORITY[current] ?? 0);
}

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    headers?: { name: string; value: string }[];
    [key: string]: unknown;
  };
}

export async function handleEmailEvents(
  req: Request,
  res: Response,
): Promise<void> {
  const payload = req.body as ResendWebhookPayload;
  const { type, data, created_at } = payload;

  const eventType = EVENT_TYPE_MAP[type];
  if (!eventType) {
    res.status(200).json({ ignored: true, type });
    return;
  }

  console.log(`[email-events] Received ${type} for email ${data.email_id}`);

  const outreachMessageId = data.headers?.find(
    (h) => h.name === "X-Outreach-Message-Id",
  )?.value;

  const outreachMessage = outreachMessageId
    ? await prisma.outreachMessage.findUnique({
        where: { id: outreachMessageId },
      })
    : await prisma.outreachMessage.findFirst({
        where: { resendId: data.email_id },
      });

  if (!outreachMessage) {
    console.log(
      `[email-events] No matching outreach message for email ${data.email_id}`,
    );
    res.status(200).json({ matched: false });
    return;
  }

  const emailEvent = await prisma.emailEvent.create({
    data: {
      outreachMessageId: outreachMessage.id,
      type: eventType,
      payload: JSON.parse(JSON.stringify(payload)),
      occurredAt: new Date(created_at),
    },
  });

  if (shouldAdvanceStatus(outreachMessage.status, eventType)) {
    await prisma.outreachMessage.update({
      where: { id: outreachMessage.id },
      data: { status: eventType as OutreachMessageStatus },
    });
  }

  if (eventType === "bounced") {
    await prisma.suppressionEntry.upsert({
      where: { email: outreachMessage.toEmail },
      update: { reason: "bounced" },
      create: { email: outreachMessage.toEmail, reason: "bounced" },
    });
    await prisma.business.update({
      where: { id: outreachMessage.businessId },
      data: { status: "bounced" },
    });
    console.log(
      `[email-events] Bounced: ${outreachMessage.toEmail} added to suppression list`,
    );
  }

  if (eventType === "complained") {
    await prisma.suppressionEntry.upsert({
      where: { email: outreachMessage.toEmail },
      update: { reason: "complained" },
      create: { email: outreachMessage.toEmail, reason: "complained" },
    });
    console.log(
      `[email-events] Complaint: ${outreachMessage.toEmail} added to suppression list`,
    );
  }

  console.log(
    `[email-events] Stored ${eventType} event ${emailEvent.id} for message ${outreachMessage.id}`,
  );

  res.status(200).json({
    eventId: emailEvent.id,
    matched: true,
    outreachMessageId: outreachMessage.id,
    statusAdvanced: shouldAdvanceStatus(outreachMessage.status, eventType),
  });
}

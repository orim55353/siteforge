import type { Request, Response } from "express";
import { prisma } from "@lead-gen/db";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL!;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

interface InboundEmailPayload {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers: { name: string; value: string }[];
}

function extractHeader(
  headers: { name: string; value: string }[],
  name: string,
): string | undefined {
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value;
}

function cleanMessageId(raw: string): string {
  return raw.replace(/^<|>$/g, "").trim();
}

export async function handleInboundEmail(
  req: Request,
  res: Response,
): Promise<void> {
  if (RESEND_WEBHOOK_SECRET) {
    const signature = req.headers["svix-signature"];
    if (!signature) {
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }
  }

  const payload = req.body as InboundEmailPayload;
  const { from, subject, text, html, headers } = payload;

  console.log(`[inbound] Received reply from: ${from}, subject: ${subject}`);

  const inReplyTo = extractHeader(headers ?? [], "In-Reply-To");
  let outreachMessage = null;

  if (inReplyTo) {
    const cleanId = cleanMessageId(inReplyTo);
    outreachMessage = await prisma.outreachMessage.findFirst({
      where: { resendId: cleanId },
      include: { business: true },
    });
  }

  if (!outreachMessage) {
    const senderEmail = from.match(/<(.+?)>/)?.[1] ?? from;
    outreachMessage = await prisma.outreachMessage.findFirst({
      where: {
        toEmail: senderEmail,
        status: "sent",
      },
      orderBy: { sentAt: "desc" },
      include: { business: true },
    });
  }

  if (!outreachMessage) {
    console.log(`[inbound] No matching outreach message found for: ${from}`);
    await forwardToFounder(from, subject, text, html);
    res.status(200).json({ matched: false, forwarded: true });
    return;
  }

  console.log(
    `[inbound] Matched to outreach ${outreachMessage.id} → business ${outreachMessage.business.name}`,
  );

  const reply = await prisma.reply.create({
    data: {
      outreachMessageId: outreachMessage.id,
      fromEmail: from,
      subject,
      bodyText: text,
      bodyHtml: html,
    },
  });

  await prisma.business.update({
    where: { id: outreachMessage.businessId },
    data: { status: "replied" },
  });

  const senderEmail = from.match(/<(.+?)>/)?.[1] ?? from;
  await forwardToFounder(
    from,
    `[Reply] ${outreachMessage.business.name}: ${subject}`,
    text,
    html,
    senderEmail,
  );

  await prisma.reply.update({
    where: { id: reply.id },
    data: { forwardedAt: new Date() },
  });

  console.log(
    `[inbound] Reply ${reply.id} stored, business updated, forwarded to founder`,
  );

  res.status(200).json({
    replyId: reply.id,
    matched: true,
    businessId: outreachMessage.businessId,
  });
}

async function forwardToFounder(
  originalFrom: string,
  subject: string,
  text?: string,
  html?: string,
  replyToAddress?: string,
): Promise<void> {
  const fromAddress =
    process.env.FORWARD_FROM_ADDRESS ?? "notifications@yourdomain.com";

  await resend.emails.send({
    from: fromAddress,
    to: FOUNDER_EMAIL,
    replyTo: replyToAddress ?? originalFrom,
    subject,
    ...(html ? { html } : { text: text ?? "(no body)" }),
  });

  console.log(`[inbound] Forwarded to founder: ${FOUNDER_EMAIL}`);
}

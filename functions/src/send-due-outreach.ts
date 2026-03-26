import type { Request, Response } from "express";
import { prisma } from "@lead-gen/db";
import { processEmailJob } from "@lead-gen/worker-email";

/**
 * Send due outreach emails — triggered by Cloud Scheduler (hourly).
 *
 * Replaces the old BullMQ scheduler + email worker combo.
 * Queries for outreach messages where scheduledFor <= now and status = 'scheduled',
 * then sends each one directly via Resend.
 *
 * Cloud Scheduler config:
 *   Schedule: "0 * * * *" (every hour)
 *   HTTP method: POST
 *   URI: https://REGION-PROJECT.cloudfunctions.net/sendDueOutreach
 */
export async function sendDueOutreach(req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();

    // ── Find all scheduled messages that are due ──
    const dueMessages = await prisma.outreachMessage.findMany({
      where: {
        status: "scheduled",
        scheduledFor: { lte: now },
      },
      select: { id: true, toEmail: true },
      orderBy: { scheduledFor: "asc" },
    });

    if (dueMessages.length === 0) {
      console.log("[sendDueOutreach] No outreach messages due");
      res.status(200).json({ sent: 0 });
      return;
    }

    console.log(`[sendDueOutreach] Found ${dueMessages.length} due messages`);

    // ── Respect daily send limit ──
    const maxPerDay = parseInt(process.env.MAX_EMAILS_PER_DAY ?? "500", 10);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sentToday = await prisma.outreachMessage.count({
      where: {
        status: "sent",
        sentAt: { gte: todayStart },
      },
    });

    const remainingQuota = Math.max(0, maxPerDay - sentToday);
    const messagesToSend = dueMessages.slice(0, remainingQuota);

    if (remainingQuota === 0) {
      console.log(`[sendDueOutreach] Daily limit reached (${maxPerDay}). Skipping.`);
      res.status(200).json({ sent: 0, reason: "daily_limit_reached" });
      return;
    }

    console.log(
      `[sendDueOutreach] Sending ${messagesToSend.length} of ${dueMessages.length} (daily limit: ${remainingQuota} remaining)`,
    );

    // ── Send each message ──
    let sentCount = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const message of messagesToSend) {
      try {
        await processEmailJob({ outreachMessageId: message.id });
        sentCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[sendDueOutreach] Failed to send ${message.id}: ${errMsg}`);
        errors.push({ id: message.id, error: errMsg });
      }
    }

    console.log(
      `[sendDueOutreach] Sent ${sentCount}/${messagesToSend.length} emails (${errors.length} errors)`,
    );

    res.status(200).json({
      sent: sentCount,
      errors: errors.length,
      errorDetails: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sendDueOutreach] Failed:", message);
    res.status(500).json({ error: message });
  }
}

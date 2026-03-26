import type { Request, Response } from "express";
import { prisma } from "@lead-gen/db";

const VALID_EVENTS = new Set([
  "checkout_viewed",
  "upsell_toggled",
  "form_started",
  "field_completed",
  "payment_attempted",
  "payment_success",
  "page_abandoned",
]);

const VALID_DEVICE_TYPES = new Set(["mobile", "tablet", "desktop"]);
const MAX_STRING_LENGTH = 500;

function sanitizeString(val: unknown, maxLen = MAX_STRING_LENGTH): string | null {
  if (typeof val !== "string" || val.length === 0) return null;
  return val.slice(0, maxLen);
}

export async function handleCheckoutEvent(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body;

    const sessionId = sanitizeString(body?.sessionId, 64);
    const event = sanitizeString(body?.event, 50);

    if (!sessionId || !event || !VALID_EVENTS.has(event)) {
      res.status(400).json({ error: "sessionId and valid event are required" });
      return;
    }

    const deviceType = sanitizeString(body?.deviceType, 20);

    await prisma.checkoutEvent.create({
      data: {
        sessionId,
        event,
        slug: sanitizeString(body?.slug, 200),
        business: sanitizeString(body?.business, 200),
        metadata: body?.metadata ?? null,
        deviceType: deviceType && VALID_DEVICE_TYPES.has(deviceType) ? deviceType : null,
        userAgent: sanitizeString(body?.userAgent),
        referer: sanitizeString(body?.referer, 2000),
      },
    });

    res.status(204).end();
  } catch (error) {
    console.error("[handleCheckoutEvent] Failed to record event:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

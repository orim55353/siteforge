import type { Request, Response } from "express";
import { prisma } from "@lead-gen/db";
import { processExtraPagesJob } from "@lead-gen/worker-extra-pages";

const VALID_DEVICE_TYPES = new Set(["mobile", "tablet", "desktop"]);
const MAX_STRING_LENGTH = 500;

function sanitizeString(val: unknown, maxLen = MAX_STRING_LENGTH): string | null {
  if (typeof val !== "string" || val.length === 0) return null;
  return val.slice(0, maxLen);
}

function sanitizeFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const num = typeof val === "number" ? val : parseFloat(String(val));
  return Number.isFinite(num) ? num : null;
}

export async function trackPageView(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body;

    const slug = sanitizeString(body?.slug, 200);
    if (!slug) {
      res.status(400).json({ error: "slug is required" });
      return;
    }

    const deviceType = sanitizeString(body?.deviceType, 20);

    await prisma.pageView.create({
      data: {
        slug,
        country: sanitizeString(body?.country, 10),
        city: sanitizeString(body?.city, 100),
        region: sanitizeString(body?.region, 100),
        latitude: sanitizeFloat(body?.latitude),
        longitude: sanitizeFloat(body?.longitude),
        userAgent: sanitizeString(body?.userAgent),
        referer: sanitizeString(body?.referer, 2000),
        deviceType: deviceType && VALID_DEVICE_TYPES.has(deviceType) ? deviceType : null,
        visitorHash: sanitizeString(body?.visitorHash, 64),
      },
    });

    // Trigger extra page generation on first view (fire-and-forget)
    triggerExtraPagesIfNeeded(slug).catch((err) => {
      console.error("[trackPageView] Failed to trigger extra pages:", err);
    });

    res.status(204).end();
  } catch (error) {
    console.error("[trackPageView] Failed to record view:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function triggerExtraPagesIfNeeded(slug: string): Promise<void> {
  const existingExtraPage = await prisma.previewPage.findFirst({
    where: {
      slug,
      pageType: { in: ["about", "services", "gallery"] },
    },
    select: { id: true },
  });

  if (existingExtraPage) return;

  const intentPage = await prisma.intentPage.findFirst({
    where: { slug, pageType: "landing" },
    select: { businessId: true },
  });

  if (!intentPage) return;

  console.log(`[trackPageView] Generating extra pages for slug=${slug}`);
  await processExtraPagesJob({ businessId: intentPage.businessId, slug });
}

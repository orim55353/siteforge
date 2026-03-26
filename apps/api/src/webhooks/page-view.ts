import type { Request, Response } from "express";
import { PrismaClient } from "@lead-gen/db";
import { processExtraPagesJob } from "@lead-gen/worker-extra-pages";

const prisma = new PrismaClient();

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

export async function handlePageView(req: Request, res: Response): Promise<void> {
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
      console.error("[page-view] Failed to trigger extra pages:", err);
    });

    res.status(204).end();
  } catch (error) {
    console.error("[page-view] Failed to record view:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Check if extra pages already exist for this slug.
 * If not, find the business and run generation directly.
 */
async function triggerExtraPagesIfNeeded(slug: string): Promise<void> {
  // Check if any extra pages already exist for this slug
  const existingExtraPage = await prisma.previewPage.findFirst({
    where: {
      slug,
      pageType: { in: ["about", "services", "gallery"] },
    },
    select: { id: true },
  });

  if (existingExtraPage) return; // Already generated

  // Find the deployed landing page to get the businessId
  const intentPage = await prisma.intentPage.findFirst({
    where: { slug, pageType: "landing" },
    select: { businessId: true },
  });

  if (!intentPage) return; // Not a deployed landing page slug

  console.log(`[page-view] Generating extra pages for slug=${slug}`);

  await processExtraPagesJob({
    businessId: intentPage.businessId,
    slug,
  });

  console.log(`[page-view] Extra pages generated for slug=${slug}`);
}

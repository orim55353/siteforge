/**
 * Enrich-only script: runs enrichment on already-discovered businesses.
 *
 * Usage:
 *   npx tsx scripts/run-enrich.ts                     # enrich all "discovered" businesses
 *   npx tsx scripts/run-enrich.ts 10                  # enrich up to 10
 *   npx tsx scripts/run-enrich.ts 5 "Miami" "FL"      # only businesses in Miami, FL
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { auditWebsite } from "../workers/enrichment/src/website-audit.js";
import { aiEnrichWebsite } from "../workers/enrichment/src/ai-enrichment.js";
import { normalizePhone } from "../workers/enrichment/src/phone-utils.js";
import { timezoneFromState } from "../workers/enrichment/src/timezone-lookup.js";
import { fetchGoogleReviews } from "../workers/enrichment/src/fetch-reviews.js";
import { fetchAndStorePhotos } from "../workers/enrichment/src/fetch-photos.js";

const prisma = new PrismaClient();

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${step}] ${msg}`);
}

function generateSlug(name: string, city: string | null, id: string): string {
  const base = [name, city].filter(Boolean).join("-");
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${clean}-${id.slice(0, 8)}`;
}

// ─── Parse CLI args ──────────────────────────────────────────
const limit = parseInt(process.argv[2] ?? "0", 10) || undefined;
const cliCity = process.argv[3];
const cliState = process.argv[4];

// ─── Enrichment ──────────────────────────────────────────────
async function enrichBusiness(businessId: string) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  log("ENRICH", `${business.name} (${business.city}, ${business.state})`);

  // Website audit
  let hasWebsite = false;
  let websiteScore: number | null = null;
  let hasSsl = false;
  let isMobileFriendly = false;
  let hasOnlineBooking = false;
  let techStack: string[] = [];
  let socialProfiles: Record<string, string> = {};
  let websiteHtml: string | null = null;

  if (business.website) {
    const audit = await auditWebsite(business.website);
    hasWebsite = audit.loads;
    websiteScore = audit.score;
    hasSsl = audit.hasSsl;
    isMobileFriendly = audit.isMobileFriendly;
    hasOnlineBooking = audit.hasOnlineBooking;
    techStack = audit.techStack;
    socialProfiles = audit.socialProfiles;
    websiteHtml = audit.loads ? audit.html : null;
    log("ENRICH", `  Website score: ${audit.score}/100`);
  } else {
    log("ENRICH", "  No website");
  }

  // AI enrichment via Claude CLI (works with or without website)
  let aiInsights: Awaited<ReturnType<typeof aiEnrichWebsite>> | null = null;
  try {
    log("ENRICH", "  Running AI analysis (Claude CLI, haiku)...");
    aiInsights = await aiEnrichWebsite({
      businessName: business.name,
      category: business.categories?.[0] ?? null,
      city: business.city,
      state: business.state,
      googleRating: business.googleRating,
      reviewCount: business.reviewCount,
      categories: business.categories ?? [],
      html: websiteHtml,
    });
    log("ENRICH", `  AI: ${aiInsights.designQuality} design, ${aiInsights.services.length} services, ${aiInsights.painPoints.length} pain points`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ENRICH", `  AI enrichment failed (non-fatal): ${message}`);
  }

  // Phone normalization + timezone
  const normalizedPhone = business.phone ? normalizePhone(business.phone) : null;
  const timezone = business.state ? timezoneFromState(business.state) : "America/Chicago";

  // Google reviews
  const serpApiKey = process.env.SERP_API_KEY;
  let reviews: Awaited<ReturnType<typeof fetchGoogleReviews>> = [];
  if (serpApiKey && (business.googleDataId || business.googlePlaceId)) {
    reviews = await fetchGoogleReviews({
      dataId: business.googleDataId,
      placeId: business.googlePlaceId,
      apiKey: serpApiKey,
      maxReviews: 5,
    });
    log("ENRICH", `  ${reviews.length} Google reviews`);
  }

  // Google Maps photos
  let photos: Awaited<ReturnType<typeof fetchAndStorePhotos>> = [];
  if (serpApiKey && business.googleDataId) {
    const slug = generateSlug(business.name, business.city, business.id);
    photos = await fetchAndStorePhotos({
      slug,
      dataId: business.googleDataId,
      apiKey: serpApiKey,
      maxPhotos: 8,
    });
    log("ENRICH", `  ${photos.length} photos compressed & stored`);
  }

  // Update business
  await prisma.business.update({
    where: { id: businessId },
    data: {
      status: "enriched",
      hasWebsite, websiteScore, hasSsl, isMobileFriendly, hasOnlineBooking,
      techStack, socialProfiles,
      phone: normalizedPhone ?? business.phone,
      timezone,
      reviews: reviews.length > 0 ? JSON.parse(JSON.stringify(reviews)) : undefined,
      photos: photos.length > 0 ? JSON.parse(JSON.stringify(photos)) : undefined,
      aiInsights: aiInsights ? JSON.parse(JSON.stringify(aiInsights)) : undefined,
    },
  });

  log("ENRICH", `  Done → enriched`);
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  // Find discovered businesses
  const where: Record<string, unknown> = { status: "discovered" };
  if (cliCity) where.city = cliCity;
  if (cliState) where.state = cliState;

  const businesses = await prisma.business.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, city: true, state: true },
    take: limit,
  });

  if (businesses.length === 0) {
    console.log("No businesses with status 'discovered' found.");
    await prisma.$disconnect();
    return;
  }

  const locationFilter = cliCity ? ` in ${cliCity}, ${cliState}` : "";
  console.log("\n========================================");
  console.log("  ENRICHMENT ONLY");
  console.log(`  Found ${businesses.length} discovered businesses${locationFilter}`);
  console.log("========================================\n");

  const startTime = Date.now();
  let succeeded = 0;
  let failed = 0;

  for (const b of businesses) {
    try {
      await enrichBusiness(b.id);
      succeeded++;
    } catch (err) {
      failed++;
      log("ENRICH", `  FAILED: ${b.name} — ${err}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n========================================");
  console.log("  DONE!");
  console.log(`  Enriched: ${succeeded} | Failed: ${failed} | Elapsed: ${elapsed}s`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

/**
 * Script 1: Discovery + Enrichment only.
 *
 * Discovers businesses via SerpAPI, then enriches each one
 * (website audit, reviews, photos, phone normalization, timezone).
 *
 * Usage:
 *   npx tsx scripts/run-discovery-enrich.ts                    # defaults: 5 businesses
 *   npx tsx scripts/run-discovery-enrich.ts 10                 # 10 businesses
 *   npx tsx scripts/run-discovery-enrich.ts 5 "barber shop" "Miami" "FL"
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { searchPlaces, type PlaceResult } from "../workers/discovery/src/serp-places.js";
import { auditWebsite } from "../workers/enrichment/src/website-audit.js";
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
const targetCount = parseInt(process.argv[2] ?? "100", 10);
const cliIndustry = process.argv[3];
const cliCity = process.argv[4];
const cliState = process.argv[5];

/** Load searches from CLI args or from active markets in the DB. */
async function loadSearches(): Promise<Array<{ industry: string; city: string; state: string }>> {
  if (cliIndustry && cliCity && cliState) {
    return [{ industry: cliIndustry, city: cliCity, state: cliState }];
  }

  const markets = await prisma.market.findMany({
    where: { active: true },
    orderBy: { opportunityScore: "desc" },
    select: { industry: true, city: true, state: true },
  });

  if (markets.length === 0) {
    console.error("No active markets in DB. Add some first:");
    console.error('  npx tsx scripts/add-markets.ts "barber shop" "Miami" "FL"');
    process.exit(1);
  }

  return markets;
}

// ─── Discovery ───────────────────────────────────────────────
async function discoverBusinesses(): Promise<string[]> {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY is not set");

  const businessIds: string[] = [];
  const searches = await loadSearches();
  let marketsProcessed = 0;
  let marketsNoResults = 0;
  let marketsNoQualifying = 0;
  let marketsAllDupes = 0;
  let marketsFailed = 0;

  for (const search of searches) {
    if (businessIds.length >= targetCount) break;

    const { industry, city, state } = search;
    const query = `${industry} in ${city}, ${state}`;

    try {
      marketsProcessed++;

      // Create or find market
      let market = await prisma.market.findFirst({ where: { industry, city, state } });
      if (!market) {
        market = await prisma.market.create({
          data: {
            name: `${industry.charAt(0).toUpperCase() + industry.slice(1)}s in ${city}, ${state}`,
            industry, city, state,
          },
        });
      }

      log("DISCOVERY", `[${marketsProcessed}/${searches.length}] Searching: "${query}"`);

      // Check cache
      const existingScan = await prisma.marketScan.findUnique({ where: { query } });
      const scanAge = existingScan ? Date.now() - existingScan.scannedAt.getTime() : Infinity;
      const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

      let places: PlaceResult[];
      if (existingScan && scanAge < CACHE_MAX_AGE_MS) {
        log("DISCOVERY", `  Using cached scan (age: ${Math.round(scanAge / 60_000)}m)`);
        places = existingScan.rawResults as unknown as PlaceResult[];
      } else {
        places = await searchPlaces(query, apiKey, 60);
      }

      if (places.length === 0) {
        marketsNoResults++;
        log("DISCOVERY", `  0 results — skipping`);
        continue;
      }

      // Filter: no website, 4.0+ rating, 50+ reviews
      const qualifying = places.filter((p) => {
        if (p.website) return false;
        if ((p.rating ?? 0) < 4.0) return false;
        if ((p.user_ratings_total ?? 0) < 50) return false;
        return true;
      });

      log("DISCOVERY", `  ${places.length} results, ${qualifying.length} qualifying`);

      // Save market scan
      const allRatings = places.map((p) => p.rating ?? 0);
      const allReviews = places.map((p) => p.user_ratings_total ?? 0);
      const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
      const avgReviews = allReviews.length > 0 ? allReviews.reduce((a, b) => a + b, 0) / allReviews.length : 0;

      await prisma.marketScan.upsert({
        where: { query },
        update: {
          rawResults: JSON.parse(JSON.stringify(places)),
          totalResults: places.length,
          withWebsite: places.filter((p) => p.website).length,
          withoutWebsite: places.filter((p) => !p.website).length,
          qualifying: qualifying.length,
          avgRating: Math.round(avgRating * 100) / 100,
          avgReviews: Math.round(avgReviews),
          topBusinesses: qualifying.slice(0, 10).map((p) => ({
            name: p.name, rating: p.rating ?? 0, reviews: p.user_ratings_total ?? 0,
          })),
          scannedAt: new Date(),
        },
        create: {
          industry, city, state, query,
          rawResults: JSON.parse(JSON.stringify(places)),
          totalResults: places.length,
          withWebsite: places.filter((p) => p.website).length,
          withoutWebsite: places.filter((p) => !p.website).length,
          qualifying: qualifying.length,
          avgRating: Math.round(avgRating * 100) / 100,
          avgReviews: Math.round(avgReviews),
          topBusinesses: qualifying.slice(0, 10).map((p) => ({
            name: p.name, rating: p.rating ?? 0, reviews: p.user_ratings_total ?? 0,
          })),
        },
      });

      if (qualifying.length === 0) {
        marketsNoQualifying++;
        continue;
      }

      // Deduplicate against DB
      const placeIds = qualifying.map((p) => p.place_id);
      const existing = await prisma.business.findMany({
        where: { googlePlaceId: { in: placeIds } },
        select: { googlePlaceId: true },
      });
      const existingIds = new Set(existing.map((b) => b.googlePlaceId));

      const remaining = targetCount - businessIds.length;
      const newPlaces = qualifying.filter((p) => !existingIds.has(p.place_id)).slice(0, remaining);

      if (newPlaces.length === 0 && qualifying.length > 0) {
        marketsAllDupes++;
        log("DISCOVERY", `  ${qualifying.length} qualifying but all already in DB`);
        continue;
      }

      for (const place of newPlaces) {
        const business = await prisma.business.upsert({
          where: { googlePlaceId: place.place_id },
          update: {},
          create: {
            marketId: market.id,
            status: "discovered",
            googlePlaceId: place.place_id,
            googleDataId: place.data_id ?? null,
            googleMapsUrl: place.place_id
              ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
              : null,
            name: place.name,
            phone: place.formatted_phone_number ?? null,
            website: null,
            address: place.formatted_address ?? null,
            city, state,
            latitude: place.geometry?.location.lat ?? null,
            longitude: place.geometry?.location.lng ?? null,
            googleRating: place.rating ?? null,
            reviewCount: place.user_ratings_total ?? 0,
            categories: place.types ?? [],
          },
        });

        businessIds.push(business.id);
        log("DISCOVERY", `  + ${place.name} (${place.rating}★ / ${place.user_ratings_total} reviews)`);
      }

      log("DISCOVERY", `  Running total: ${businessIds.length}/${targetCount}`);
    } catch (err) {
      marketsFailed++;
      log("DISCOVERY", `  FAILED: ${query} — ${err}`);
    }
  }

  log("SUMMARY", `Markets processed: ${marketsProcessed}/${searches.length}`);
  log("SUMMARY", `  No results: ${marketsNoResults} | No qualifying: ${marketsNoQualifying} | All dupes: ${marketsAllDupes} | Failed: ${marketsFailed}`);

  return businessIds;
}

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

  if (business.website) {
    const audit = await auditWebsite(business.website);
    hasWebsite = audit.loads;
    websiteScore = audit.score;
    hasSsl = audit.hasSsl;
    isMobileFriendly = audit.isMobileFriendly;
    hasOnlineBooking = audit.hasOnlineBooking;
    techStack = audit.techStack;
    socialProfiles = audit.socialProfiles;
    log("ENRICH", `  Website score: ${audit.score}/100`);
  } else {
    log("ENRICH", "  No website");
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
    },
  });

  log("ENRICH", `  Done → enriched`);
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log("\n========================================");
  console.log("  DISCOVERY + ENRICHMENT");
  console.log(`  Target: ${targetCount} businesses`);
  console.log("========================================\n");

  const startTime = Date.now();

  // Step 1: Discovery
  console.log("--- Discovery ---");
  const businessIds = await discoverBusinesses();
  log("SUMMARY", `Discovered ${businessIds.length} businesses`);

  // Step 2: Enrichment
  console.log("\n--- Enrichment ---");
  for (const id of businessIds) {
    await enrichBusiness(id);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: { id: true, name: true, city: true, state: true, status: true, googleRating: true, reviewCount: true },
  });

  console.log("\n========================================");
  console.log("  DONE!");
  console.log("========================================");
  for (const b of businesses) {
    console.log(`  ${b.name} (${b.city}, ${b.state})`);
    console.log(`    Rating: ${b.googleRating}★ | Reviews: ${b.reviewCount} | Status: ${b.status}`);
    console.log(`    ID: ${b.id}`);
  }
  console.log(`\n  Total: ${businesses.length} | Elapsed: ${elapsed}s`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

/**
 * Discovery-only test — finds businesses matching our criteria:
 *   - No website
 *   - 4.0+ rating
 *   - 50+ reviews
 *
 * Usage: npx tsx scripts/test-discovery.ts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { searchPlaces, type PlaceResult } from "../workers/discovery/src/serp-places.js";

// ─── Config ───────────────────────────────────────────────────
const TARGET_COUNT = 5;

// Try multiple industry/location combos to find no-website businesses
const SEARCHES = [
  { industry: "taqueria", city: "Houston", state: "TX" },
  { industry: "barber shop", city: "Miami", state: "FL" },
  { industry: "auto mechanic", city: "San Antonio", state: "TX" },
  { industry: "nail salon", city: "Dallas", state: "TX" },
  { industry: "tailor", city: "Chicago", state: "IL" },
  { industry: "car wash", city: "Phoenix", state: "AZ" },
  { industry: "laundromat", city: "Los Angeles", state: "CA" },
];

const prisma = new PrismaClient();

function log(msg: string) {
  console.log(`[DISCOVERY] ${msg}`);
}

async function main() {
  console.log("\n========================================");
  console.log("  DISCOVERY TEST — No-Website Businesses");
  console.log(`  Target: ${TARGET_COUNT} businesses`);
  console.log(`  Criteria: no website, 4.0+ rating, 50+ reviews`);
  console.log("========================================\n");

  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY is not set");

  const inserted: Array<{ id: string; name: string; rating: number; reviews: number; city: string; industry: string }> = [];

  for (const search of SEARCHES) {
    if (inserted.length >= TARGET_COUNT) break;

    const { industry, city, state } = search;

    // Create or find market
    let market = await prisma.market.findFirst({
      where: { industry, city, state },
    });
    if (!market) {
      market = await prisma.market.create({
        data: {
          name: `${industry.charAt(0).toUpperCase() + industry.slice(1)}s in ${city}, ${state}`,
          industry,
          city,
          state,
        },
      });
    }

    const query = `${industry} in ${city}, ${state}`;
    log(`Searching: "${query}"`);

    // Check if we already have a recent scan (< 24h)
    const existingScan = await prisma.marketScan.findUnique({ where: { query } });
    const scanAge = existingScan ? Date.now() - existingScan.scannedAt.getTime() : Infinity;
    const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

    let places: PlaceResult[];

    if (existingScan && scanAge < CACHE_MAX_AGE_MS) {
      log(`  Using cached scan (age: ${Math.round(scanAge / 60_000)}m)`);
      places = existingScan.rawResults as unknown as PlaceResult[];
    } else {
      places = await searchPlaces(query, apiKey, 60);
    }

    const withWebsiteCount = places.filter((p) => p.website).length;
    const withoutWebsiteCount = places.filter((p) => !p.website).length;
    log(`  Results: ${places.length} total (${withWebsiteCount} with website, ${withoutWebsiteCount} without)`);

    // Apply filters
    const qualifying = places.filter((p) => {
      if (p.website) return false;
      if ((p.rating ?? 0) < 4.0) return false;
      if ((p.user_ratings_total ?? 0) < 50) return false;
      return true;
    });

    log(`  Qualifying: ${qualifying.length}`);

    // Compute stats and save MarketScan
    const allRatings = places.map((p) => p.rating ?? 0);
    const allReviews = places.map((p) => p.user_ratings_total ?? 0);
    const avgRating = allRatings.length > 0
      ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
      : 0;
    const avgReviews = allReviews.length > 0
      ? allReviews.reduce((a, b) => a + b, 0) / allReviews.length
      : 0;

    const topBusinesses = qualifying.slice(0, 10).map((p) => ({
      name: p.name,
      rating: p.rating ?? 0,
      reviews: p.user_ratings_total ?? 0,
      address: p.formatted_address ?? null,
      phone: p.formatted_phone_number ?? null,
    }));

    await prisma.marketScan.upsert({
      where: { query },
      update: {
        rawResults: JSON.parse(JSON.stringify(places)),
        totalResults: places.length,
        withWebsite: withWebsiteCount,
        withoutWebsite: withoutWebsiteCount,
        qualifying: qualifying.length,
        avgRating: Math.round(avgRating * 100) / 100,
        avgReviews: Math.round(avgReviews),
        topBusinesses,
        scannedAt: new Date(),
      },
      create: {
        industry,
        city,
        state,
        query,
        rawResults: JSON.parse(JSON.stringify(places)),
        totalResults: places.length,
        withWebsite: withWebsiteCount,
        withoutWebsite: withoutWebsiteCount,
        qualifying: qualifying.length,
        avgRating: Math.round(avgRating * 100) / 100,
        avgReviews: Math.round(avgReviews),
        topBusinesses,
      },
    });

    if (qualifying.length === 0) continue;

    // Deduplicate against DB
    const placeIds = qualifying.map((p) => p.place_id);
    const existing = await prisma.business.findMany({
      where: { googlePlaceId: { in: placeIds } },
      select: { googlePlaceId: true },
    });
    const existingIds = new Set(existing.map((b) => b.googlePlaceId));

    const remaining = TARGET_COUNT - inserted.length;
    const newPlaces = qualifying
      .filter((p) => !existingIds.has(p.place_id))
      .slice(0, remaining);

    for (const place of newPlaces) {
      const googleMapsUrl = place.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
        : null;

      const business = await prisma.business.upsert({
        where: { googlePlaceId: place.place_id },
        update: {}, // Already exists — skip
        create: {
          marketId: market.id,
          status: "discovered",
          googlePlaceId: place.place_id,
          googleDataId: place.data_id ?? null,
          googleMapsUrl,
          name: place.name,
          phone: place.formatted_phone_number ?? null,
          website: null,
          address: place.formatted_address ?? null,
          city,
          state,
          latitude: place.geometry?.location.lat ?? null,
          longitude: place.geometry?.location.lng ?? null,
          googleRating: place.rating ?? null,
          reviewCount: place.user_ratings_total ?? 0,
          categories: place.types ?? [],
        },
      });

      inserted.push({
        id: business.id,
        name: place.name,
        rating: place.rating ?? 0,
        reviews: place.user_ratings_total ?? 0,
        city,
        industry,
      });

      log(`  + ${place.name} (${place.rating}* / ${place.user_ratings_total} reviews)`);
    }

    log(`  Running total: ${inserted.length}/${TARGET_COUNT}\n`);
  }

  // Summary
  console.log("========================================");
  console.log("  DISCOVERY RESULTS");
  console.log("========================================");
  if (inserted.length === 0) {
    console.log("  No qualifying businesses found across all searches.");
  } else {
    for (const b of inserted) {
      console.log(`  ${b.name} (${b.industry} in ${b.city})`);
      console.log(`    Rating: ${b.rating} | Reviews: ${b.reviews} | No website`);
      console.log(`    ID: ${b.id}`);
      console.log();
    }
  }
  console.log(`  Total inserted: ${inserted.length}`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

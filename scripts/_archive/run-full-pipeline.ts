/**
 * Script 3: Full Pipeline — Discovery → Enrichment → Scoring → Page-Gen → Deploy.
 *
 * Runs the complete lead generation pipeline end-to-end.
 *
 * Usage:
 *   npx tsx scripts/run-full-pipeline.ts             # defaults: 3 businesses
 *   npx tsx scripts/run-full-pipeline.ts 5            # 5 businesses
 *   npx tsx scripts/run-full-pipeline.ts 3 "barber shop" "Miami" "FL"
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
import { scoreBusiness } from "../workers/scoring/src/score.js";
import { generatePage } from "../workers/page-gen/src/ai-content.js";
import { deployToCloudflare } from "../workers/deploy/src/cloudflare.js";
import { createClient } from "@supabase/supabase-js";

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
    select: { industry: true, city: true, state: true },
  });

  if (markets.length === 0) {
    console.error("No active markets in DB. Add some first:");
    console.error('  npx tsx scripts/add-markets.ts "barber shop" "Miami" "FL"');
    process.exit(1);
  }

  return markets;
}

interface PipelineResult {
  name: string;
  city: string | null;
  score: number | null;
  qualified: boolean;
  deployedUrl: string | null;
  htmlSize: number;
  timings: { discovery: string; enrichment: string; scoring: string; pageGen: string; deploy: string; total: string };
}

// ─── Process one business through the entire pipeline ────────
async function processOneBusiness(
  place: PlaceResult,
  marketId: string,
  city: string,
  state: string,
  index: number,
): Promise<PipelineResult> {
  const label = `[${index + 1}/${targetCount}]`;
  const timings: Record<string, string> = {};
  let stepStart = Date.now();
  const globalStart = Date.now();

  // ── 1. Discovery (create business) ──
  const googleMapsUrl = place.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
    : null;

  const business = await prisma.business.upsert({
    where: { googlePlaceId: place.place_id },
    update: {},
    create: {
      marketId,
      status: "discovered",
      googlePlaceId: place.place_id,
      googleDataId: place.data_id ?? null,
      googleMapsUrl,
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

  log("DISCOVERY", `${label} ${business.name} (${place.rating}★ / ${place.user_ratings_total} reviews)`);
  timings.discovery = ((Date.now() - stepStart) / 1000).toFixed(1);

  // ── 2. Enrichment ──
  stepStart = Date.now();
  log("ENRICH", `${label} Enriching...`);

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
  }

  const normalizedPhone = business.phone ? normalizePhone(business.phone) : null;
  const timezone = state ? timezoneFromState(state) : "America/Chicago";

  // Reviews
  const serpApiKey = process.env.SERP_API_KEY;
  if (!serpApiKey) throw new Error("SERP_API_KEY is not set");
  let reviews: Awaited<ReturnType<typeof fetchGoogleReviews>> = [];
  if (business.googleDataId || business.googlePlaceId) {
    reviews = await fetchGoogleReviews({
      dataId: business.googleDataId,
      placeId: business.googlePlaceId,
      apiKey: serpApiKey,
      maxReviews: 5,
    });
    log("ENRICH", `${label} ${reviews.length} reviews`);
  }

  // Photos
  let photos: Awaited<ReturnType<typeof fetchAndStorePhotos>> = [];
  const slug = generateSlug(business.name, business.city, business.id);
  if (business.googleDataId) {
    photos = await fetchAndStorePhotos({
      slug,
      dataId: business.googleDataId,
      apiKey: serpApiKey,
      maxPhotos: 8,
    });
    log("ENRICH", `${label} ${photos.length} photos`);
  }

  await prisma.business.update({
    where: { id: business.id },
    data: {
      status: "enriched",
      hasWebsite, websiteScore, hasSsl, isMobileFriendly, hasOnlineBooking,
      techStack, socialProfiles,
      phone: normalizedPhone ?? business.phone,
      timezone,
      reviews: reviews.length > 0 ? JSON.parse(JSON.stringify(reviews)) : undefined,
      photos: photos.length > 0 ? JSON.parse(JSON.stringify(photos)) : undefined,
      googleMapsUrl: business.googleMapsUrl ?? googleMapsUrl,
    },
  });

  timings.enrichment = ((Date.now() - stepStart) / 1000).toFixed(1);

  // ── 3. Scoring ──
  stepStart = Date.now();
  const scoreResult = scoreBusiness({
    googleRating: business.googleRating ? Number(business.googleRating) : null,
    reviewCount: business.reviewCount,
    websiteScore,
    hasWebsite,
  });

  log("SCORING", `${label} Score: ${scoreResult.totalScore}/100 | Qualified: ${scoreResult.qualified}`);

  await prisma.business.update({
    where: { id: business.id },
    data: {
      status: scoreResult.qualified ? "qualified" : "disqualified",
      score: scoreResult.totalScore,
      scoreBreakdown: {
        ratingScore: scoreResult.ratingScore,
        reviewScore: scoreResult.reviewScore,
        websiteScore: scoreResult.websiteScore,
        qualified: scoreResult.qualified,
        reasons: scoreResult.reasons,
      },
    },
  });

  timings.scoring = ((Date.now() - stepStart) / 1000).toFixed(1);

  if (!scoreResult.qualified) {
    log("SCORING", `${label} Disqualified — skipping page-gen & deploy`);
    return {
      name: business.name, city: business.city,
      score: scoreResult.totalScore, qualified: false,
      deployedUrl: null, htmlSize: 0,
      timings: { ...timings, pageGen: "0", deploy: "0", total: ((Date.now() - globalStart) / 1000).toFixed(1) },
    };
  }

  // ── 4. Page Generation ──
  stepStart = Date.now();
  log("PAGE-GEN", `${label} Generating HTML via Claude CLI...`);

  const enrichedBusiness = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  const html = await generatePage(enrichedBusiness);
  log("PAGE-GEN", `${label} ${html.length} bytes`);

  // Validate
  if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
    throw new Error("Generated HTML missing doctype/html tag");
  }
  if (!html.includes("</html>")) {
    throw new Error("Generated HTML missing closing </html> tag");
  }

  // Upload to Supabase Storage
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);
  const filePath = `${slug}.html`;
  await supabase.storage.createBucket("preview-pages", { public: true });
  const { error: uploadError } = await supabase.storage
    .from("preview-pages")
    .upload(filePath, html, { contentType: "text/html", upsert: true });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from("preview-pages").getPublicUrl(filePath);
  const htmlUrl = urlData.publicUrl;

  const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? "";
  const previewUrl = `${previewBaseUrl}/${slug}`;

  const previewPage = await prisma.previewPage.upsert({
    where: { slug },
    update: {
      aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
      htmlUrl, previewUrl,
    },
    create: {
      businessId: business.id, slug, templateId: "ai-generated",
      aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
      htmlUrl, previewUrl,
    },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: { status: "page_generated" },
  });

  timings.pageGen = ((Date.now() - stepStart) / 1000).toFixed(1);

  // ── 5. Deploy to R2 ──
  stepStart = Date.now();
  log("DEPLOY", `${label} Deploying to R2...`);

  const { deployedUrl, r2Keys } = await deployToCloudflare(slug, html, [], business.name);
  log("DEPLOY", `${label} ${r2Keys.length} files → ${deployedUrl}`);

  await prisma.intentPage.upsert({
    where: { slug },
    update: {
      aiContent: previewPage.aiContent as object,
      htmlUrl, deployedUrl,
    },
    create: {
      businessId: business.id, slug,
      templateId: previewPage.templateId,
      aiContent: previewPage.aiContent as object,
      htmlUrl, deployedUrl,
    },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: { status: "page_deployed" },
  });

  timings.deploy = ((Date.now() - stepStart) / 1000).toFixed(1);
  timings.total = ((Date.now() - globalStart) / 1000).toFixed(1);

  return {
    name: business.name, city: business.city,
    score: scoreResult.totalScore, qualified: true,
    deployedUrl, htmlSize: html.length, timings,
  };
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log("\n========================================");
  console.log("  FULL PIPELINE");
  console.log(`  Target: ${targetCount} businesses`);
  console.log("========================================\n");

  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) throw new Error("SERP_API_KEY is not set");

  const globalStart = Date.now();
  const results: PipelineResult[] = [];
  let businessIndex = 0;
  const searches = await loadSearches();

  for (const search of searches) {
    if (results.filter((r) => r.qualified).length >= targetCount) break;

    const { industry, city, state } = search;

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

    const query = `${industry} in ${city}, ${state}`;
    log("DISCOVERY", `Searching: "${query}"`);

    // Check cache
    const existingScan = await prisma.marketScan.findUnique({ where: { query } });
    const scanAge = existingScan ? Date.now() - existingScan.scannedAt.getTime() : Infinity;
    const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

    let places: PlaceResult[];
    if (existingScan && scanAge < CACHE_MAX_AGE_MS) {
      log("DISCOVERY", `  Cached (age: ${Math.round(scanAge / 60_000)}m)`);
      places = existingScan.rawResults as unknown as PlaceResult[];
    } else {
      places = await searchPlaces(query, apiKey, 60);
    }

    // Filter
    const qualifying = places.filter((p) => {
      if (p.website) return false;
      if ((p.rating ?? 0) < 4.0) return false;
      if ((p.user_ratings_total ?? 0) < 50) return false;
      return true;
    });

    log("DISCOVERY", `  ${places.length} results, ${qualifying.length} qualifying`);

    // Save market scan
    const allRatings = places.map((p) => p.rating ?? 0);
    const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
    const allReviews = places.map((p) => p.user_ratings_total ?? 0);
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

    // Deduplicate
    const placeIds = qualifying.map((p) => p.place_id);
    const existing = await prisma.business.findMany({
      where: { googlePlaceId: { in: placeIds } },
      select: { googlePlaceId: true },
    });
    const existingIds = new Set(existing.map((b) => b.googlePlaceId));

    const remaining = targetCount - results.filter((r) => r.qualified).length;
    const newPlaces = qualifying.filter((p) => !existingIds.has(p.place_id)).slice(0, remaining);

    for (const place of newPlaces) {
      try {
        const result = await processOneBusiness(place, market.id, city, state, businessIndex);
        results.push(result);
        businessIndex++;
      } catch (err) {
        log("ERROR", `Failed processing ${place.name}: ${err}`);
      }
    }
  }

  // Summary
  const totalElapsed = ((Date.now() - globalStart) / 1000).toFixed(1);
  const qualified = results.filter((r) => r.qualified);
  const disqualified = results.filter((r) => !r.qualified);

  console.log("\n========================================");
  console.log("  FULL PIPELINE — RESULTS");
  console.log("========================================");

  for (const r of qualified) {
    console.log(`\n  ✓ ${r.name} (${r.city})`);
    console.log(`    Score:    ${r.score}/100`);
    console.log(`    Live:     ${r.deployedUrl}`);
    console.log(`    HTML:     ${r.htmlSize} bytes`);
    console.log(`    Timings:  discovery ${r.timings.discovery}s → enrich ${r.timings.enrichment}s → score ${r.timings.scoring}s → page-gen ${r.timings.pageGen}s → deploy ${r.timings.deploy}s = ${r.timings.total}s`);
  }

  for (const r of disqualified) {
    console.log(`\n  ✗ ${r.name} (${r.city}) — disqualified (score: ${r.score})`);
  }

  console.log(`\n  Qualified: ${qualified.length} | Disqualified: ${disqualified.length} | Total: ${totalElapsed}s`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

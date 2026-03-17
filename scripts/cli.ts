#!/usr/bin/env npx tsx
/**
 * Lead Gen CLI — single entry point for all pipeline operations.
 *
 * Usage:
 *   npx tsx scripts/cli.ts <command> [options]
 *
 * Commands:
 *   sync-markets          Sync markets from data.md into the database
 *   discover              Search for new businesses via SerpAPI
 *   enrich                Enrich + score discovered businesses
 *   score                 Score (or re-score) enriched businesses
 *   publish               Generate pages, store, and deploy to R2
 *   pipeline              Full pipeline: enrich → score → publish
 *   status                Show pipeline status counts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { Command } from "commander";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const program = new Command();

// ─── Shared utilities ────────────────────────────────────────

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${step}] ${msg}`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem}s`;
}

function progress(current: number, total: number, startMs: number): string {
  const pct = Math.round((current / total) * 100);
  const elapsed = Date.now() - startMs;
  const perItem = current > 0 ? elapsed / current : 0;
  const remaining = perItem * (total - current);
  const eta = current > 0 ? ` | ETA ${formatDuration(remaining)}` : "";
  const bar = renderBar(current, total, 20);
  return `${bar} ${current}/${total} (${pct}%)${eta}`;
}

function renderBar(current: number, total: number, width: number): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${"=".repeat(filled)}${empty > 0 ? ">" : ""}${".".repeat(Math.max(0, empty - 1))}]`;
}

function generateSlug(name: string, city: string | null, id: string): string {
  const base = [name, city].filter(Boolean).join("-");
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${clean}-${id.slice(0, 8)}`;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

async function shutdown() {
  await prisma.$disconnect();
}

// ─── sync-markets ────────────────────────────────────────────

program
  .command("sync-markets")
  .description("Sync markets from data.md into the database")
  .argument("[file]", "path to data.md", "data.md")
  .action(async (file: string) => {
    const { readFile } = await import("node:fs/promises");
    const resolved = join(__dirname, "..", file);

    console.log(`\nReading: ${resolved}`);
    const content = await readFile(resolved, "utf-8");
    const cities = parseDataMd(content);

    const allMarkets = cities.flatMap((c) => c.markets);
    console.log(`Parsed ${cities.length} cities, ${allMarkets.length} market entries\n`);

    if (allMarkets.length === 0) {
      console.error("No markets found in file. Check the format.");
      process.exit(1);
    }

    const dataFileKeys = new Set(
      allMarkets.map((m) => `${m.industry}|${m.city}|${m.state}`),
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const city of cities) {
      console.log(`  ${city.city}, ${city.state} (city score: ${city.cityScore}) — ${city.markets.length} industries`);

      for (const m of city.markets) {
        const name = `${m.industry.charAt(0).toUpperCase() + m.industry.slice(1)} in ${m.city}, ${m.state}`;

        const existing = await prisma.market.findUnique({
          where: { industry_city_state: { industry: m.industry, city: m.city, state: m.state } },
        });

        if (existing) {
          const changed =
            existing.opportunityScore !== m.opportunityScore ||
            existing.marketSize !== m.marketSize ||
            existing.digitalGap !== m.digitalGap ||
            existing.notes !== m.notes ||
            !existing.active;

          if (changed) {
            await prisma.market.update({
              where: { id: existing.id },
              data: {
                name,
                opportunityScore: m.opportunityScore,
                marketSize: m.marketSize,
                digitalGap: m.digitalGap,
                notes: m.notes,
                sourceFile: file,
                active: true,
              },
            });
            updated++;
          } else {
            unchanged++;
          }
        } else {
          await prisma.market.create({
            data: {
              name,
              industry: m.industry,
              city: m.city,
              state: m.state,
              opportunityScore: m.opportunityScore,
              marketSize: m.marketSize,
              digitalGap: m.digitalGap,
              notes: m.notes,
              sourceFile: file,
              active: true,
            },
          });
          created++;
        }
      }
    }

    // Deactivate removed markets
    const fileSourcedMarkets = await prisma.market.findMany({
      where: { sourceFile: { not: null }, active: true },
      select: { id: true, industry: true, city: true, state: true },
    });

    let deactivated = 0;
    for (const m of fileSourcedMarkets) {
      const key = `${m.industry}|${m.city}|${m.state}`;
      if (!dataFileKeys.has(key)) {
        await prisma.market.update({
          where: { id: m.id },
          data: { active: false },
        });
        deactivated++;
      }
    }

    console.log(`\n  Created: ${created} | Updated: ${updated} | Unchanged: ${unchanged} | Deactivated: ${deactivated}`);
    await shutdown();
  });

// ─── discover ────────────────────────────────────────────────

program
  .command("discover")
  .description("Search for new businesses via SerpAPI")
  .option("-l, --limit <n>", "max businesses to add", "100")
  .option("--industry <name>", "specific industry")
  .option("--city <name>", "specific city")
  .option("--state <code>", "specific state")
  .action(async (opts) => {
    const serpModule = await import("../workers/discovery/src/serp-places.js");
    const searchPlaces = serpModule.searchPlaces;
    type PlaceResult = Awaited<ReturnType<typeof searchPlaces>>[number];
    const apiKey = requireEnv("SERP_API_KEY");
    const targetCount = parseInt(opts.limit, 10);

    const searches = opts.industry && opts.city && opts.state
      ? [{ industry: opts.industry, city: opts.city, state: opts.state }]
      : await loadActiveMarkets();

    console.log(`\n  DISCOVER — target: ${targetCount} businesses from ${searches.length} markets\n`);

    const businessIds: string[] = [];
    let processed = 0;
    const discoverStart = Date.now();

    for (const search of searches) {
      if (businessIds.length >= targetCount) break;
      processed++;

      const { industry, city, state } = search;
      const query = `${industry} in ${city}, ${state}`;

      try {
        let market = await prisma.market.findFirst({ where: { industry, city, state } });
        if (!market) {
          market = await prisma.market.create({
            data: {
              name: `${industry.charAt(0).toUpperCase() + industry.slice(1)}s in ${city}, ${state}`,
              industry, city, state,
            },
          });
        }

        log("DISCOVER", `${progress(processed, searches.length, discoverStart)} "${query}"`);

        // Check cache (24h)
        const existingScan = await prisma.marketScan.findUnique({ where: { query } });
        const scanAge = existingScan ? Date.now() - existingScan.scannedAt.getTime() : Infinity;
        const CACHE_MS = 24 * 60 * 60 * 1000;

        let places: PlaceResult[];
        if (existingScan && scanAge < CACHE_MS) {
          log("DISCOVER", `  Cached (age: ${Math.round(scanAge / 60_000)}m)`);
          places = existingScan.rawResults as unknown as PlaceResult[];
        } else {
          places = await searchPlaces(query, apiKey, 60);
        }

        // Filter: no website, 4.0+ rating, 50+ reviews
        const qualifying = places.filter(
          (p) => !p.website && (p.rating ?? 0) >= 4.0 && (p.user_ratings_total ?? 0) >= 50,
        );

        log("DISCOVER", `  ${places.length} results, ${qualifying.length} qualifying`);

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

        // Deduplicate
        const placeIds = qualifying.map((p) => p.place_id);
        const existing = await prisma.business.findMany({
          where: { googlePlaceId: { in: placeIds } },
          select: { googlePlaceId: true },
        });
        const existingIds = new Set(existing.map((b) => b.googlePlaceId));

        const remaining = targetCount - businessIds.length;
        const newPlaces = qualifying.filter((p) => !existingIds.has(p.place_id)).slice(0, remaining);

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
          log("DISCOVER", `  + ${place.name} (${place.rating}★ / ${place.user_ratings_total} reviews)`);
        }
      } catch (err) {
        log("DISCOVER", `  FAILED: ${query} — ${err}`);
      }
    }

    const discoverElapsed = formatDuration(Date.now() - discoverStart);
    console.log(`\n  Discovered: ${businessIds.length} new businesses | Markets searched: ${processed}/${searches.length} | Elapsed: ${discoverElapsed}`);
    await shutdown();
  });

// ─── enrich ──────────────────────────────────────────────────

program
  .command("enrich")
  .description("Enrich + score discovered/un-enriched businesses")
  .option("-l, --limit <n>", "max businesses to process")
  .option("--id <businessId>", "enrich a specific business")
  .option("--skip-ai", "skip AI enrichment step")
  .action(async (opts) => {
    const { auditWebsite } = await import("../workers/enrichment/src/website-audit.js");
    const { aiEnrichWebsite } = await import("../workers/enrichment/src/ai-enrichment.js");
    const { normalizePhone } = await import("../workers/enrichment/src/phone-utils.js");
    const { timezoneFromState } = await import("../workers/enrichment/src/timezone-lookup.js");
    const { fetchGoogleReviews } = await import("../workers/enrichment/src/fetch-reviews.js");
    const { fetchAndStorePhotos } = await import("../workers/enrichment/src/fetch-photos.js");
    const { scoreBusiness } = await import("../workers/scoring/src/score.js");

    const serpApiKey = process.env.SERP_API_KEY;

    // Resolve businesses to process
    let businesses: Array<{ id: string; name: string; city: string | null; state: string | null }>;

    if (opts.id) {
      const b = await prisma.business.findUniqueOrThrow({
        where: { id: opts.id },
        select: { id: true, name: true, city: true, state: true },
      });
      businesses = [b];
    } else {
      businesses = await prisma.business.findMany({
        where: { status: "discovered" },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, city: true, state: true },
        ...(opts.limit ? { take: parseInt(opts.limit, 10) } : {}),
      });
    }

    if (businesses.length === 0) {
      console.log("No businesses to enrich.");
      await shutdown();
      return;
    }

    console.log(`\n  ENRICH + SCORE — ${businesses.length} businesses\n`);

    const startTime = Date.now();
    let succeeded = 0;
    let failed = 0;

    for (let idx = 0; idx < businesses.length; idx++) {
      const b = businesses[idx];
      try {
        const business = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
        log("ENRICH", `${progress(idx + 1, businesses.length, startTime)} ${business.name} (${business.city}, ${business.state})`);

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

        // AI enrichment
        let aiInsights: Awaited<ReturnType<typeof aiEnrichWebsite>> | null = null;
        if (!opts.skipAi) {
          try {
            log("ENRICH", "  Running AI analysis...");
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
            log("ENRICH", `  AI: ${aiInsights.designQuality} design, ${aiInsights.services.length} services`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log("ENRICH", `  AI enrichment failed (non-fatal): ${message}`);
          }
        }

        // Phone + timezone
        const normalizedPhone = business.phone ? normalizePhone(business.phone) : null;
        const timezone = business.state ? timezoneFromState(business.state) : "America/Chicago";

        // Google reviews
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

        // Photos
        let photos: Awaited<ReturnType<typeof fetchAndStorePhotos>> = [];
        if (serpApiKey && business.googleDataId) {
          const slug = generateSlug(business.name, business.city, business.id);
          photos = await fetchAndStorePhotos({
            slug,
            dataId: business.googleDataId,
            apiKey: serpApiKey,
            maxPhotos: 8,
          });
          log("ENRICH", `  ${photos.length} photos`);
        }

        // Save enrichment
        await prisma.business.update({
          where: { id: b.id },
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

        // Score
        const scoreResult = scoreBusiness({
          googleRating: business.googleRating ? Number(business.googleRating) : null,
          reviewCount: business.reviewCount,
          websiteScore,
          hasWebsite,
        });

        const newStatus = scoreResult.qualified ? "qualified" : "disqualified";

        await prisma.business.update({
          where: { id: b.id },
          data: {
            status: newStatus,
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

        log("ENRICH", `  Score: ${scoreResult.totalScore}/100 → ${newStatus}`);
        succeeded++;
      } catch (err) {
        failed++;
        log("ENRICH", `  FAILED: ${b.name} — ${err}`);
      }
    }

    const elapsed = formatDuration(Date.now() - startTime);
    console.log(`\n  Done: ${succeeded} enriched+scored | ${failed} failed | ${elapsed}`);
    await shutdown();
  });

// ─── score ──────────────────────────────────────────────────

program
  .command("score")
  .description("Score (or re-score) enriched businesses")
  .option("-l, --limit <n>", "max businesses to process")
  .option("--id <businessId>", "score a specific business")
  .option("--rescore", "re-score already scored businesses (qualified/disqualified)")
  .option("--dry-run", "show scores without saving to database")
  .action(async (opts) => {
    const { scoreBusiness } = await import("../workers/scoring/src/score.js");

    // Resolve businesses to score
    const statusFilter = opts.rescore
      ? { in: ["enriched", "qualified", "disqualified"] }
      : "enriched";

    let businesses: Array<{
      id: string; name: string; city: string | null; state: string | null;
      googleRating: unknown; reviewCount: number | null;
      websiteScore: number | null; hasWebsite: boolean | null;
      score: number | null; status: string;
    }>;

    if (opts.id) {
      const b = await prisma.business.findUniqueOrThrow({
        where: { id: opts.id },
        select: {
          id: true, name: true, city: true, state: true,
          googleRating: true, reviewCount: true,
          websiteScore: true, hasWebsite: true,
          score: true, status: true,
        },
      });
      businesses = [b];
    } else {
      businesses = await prisma.business.findMany({
        where: { status: statusFilter },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, city: true, state: true,
          googleRating: true, reviewCount: true,
          websiteScore: true, hasWebsite: true,
          score: true, status: true,
        },
        ...(opts.limit ? { take: parseInt(opts.limit, 10) } : {}),
      });
    }

    if (businesses.length === 0) {
      console.log("No businesses to score.");
      await shutdown();
      return;
    }

    const mode = opts.dryRun ? "DRY RUN" : "SCORE";
    console.log(`\n  ${mode} — ${businesses.length} businesses${opts.rescore ? " (including re-score)" : ""}\n`);

    const startTime = Date.now();
    let qualified = 0;
    let disqualified = 0;
    let failed = 0;

    for (let idx = 0; idx < businesses.length; idx++) {
      const biz = businesses[idx];
      try {
        const result = scoreBusiness({
          googleRating: biz.googleRating ? Number(biz.googleRating) : null,
          reviewCount: biz.reviewCount,
          websiteScore: biz.websiteScore,
          hasWebsite: biz.hasWebsite ?? false,
        });

        const newStatus = result.qualified ? "qualified" : "disqualified";
        const prevScore = biz.score !== null ? ` (was ${biz.score})` : "";
        const arrow = result.qualified ? "✓" : "✗";

        log("SCORE", `${progress(idx + 1, businesses.length, startTime)} ${arrow} ${biz.name} — ${result.totalScore}/100${prevScore} → ${newStatus}`);

        if (result.reasons.length > 0) {
          log("SCORE", `    ${result.reasons.join("; ")}`);
        }

        if (!opts.dryRun) {
          await prisma.business.update({
            where: { id: biz.id },
            data: {
              status: newStatus,
              score: result.totalScore,
              scoreBreakdown: {
                ratingScore: result.ratingScore,
                reviewScore: result.reviewScore,
                websiteScore: result.websiteScore,
                qualified: result.qualified,
                reasons: result.reasons,
              },
            },
          });
        }

        if (result.qualified) qualified++;
        else disqualified++;
      } catch (err) {
        failed++;
        log("SCORE", `  FAILED: ${biz.name} — ${err}`);
      }
    }

    const elapsed = formatDuration(Date.now() - startTime);
    console.log(`\n  ${mode} complete: ${qualified} qualified | ${disqualified} disqualified | ${failed} failed | ${elapsed}`);
    await shutdown();
  });

// ─── publish ─────────────────────────────────────────────────

program
  .command("publish")
  .description("Generate pages, store to Supabase, and deploy to R2")
  .option("-l, --limit <n>", "max businesses to process", "100")
  .option("--id <businessId>", "publish a specific business")
  .action(async (opts) => {
    const { generatePage } = await import("../workers/page-gen/src/ai-content.js");
    const { fetchGoogleReviews } = await import("../workers/enrichment/src/fetch-reviews.js");
    const { deployToCloudflare } = await import("../workers/deploy/src/cloudflare.js");
    const { createClient } = await import("@supabase/supabase-js");
    const { scoreBusiness } = await import("../workers/scoring/src/score.js");

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseKey = requireEnv("SUPABASE_SERVICE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const serpApiKey = process.env.SERP_API_KEY;
    const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? "";

    // Resolve businesses
    let businesses: Array<{
      id: string; name: string; city: string | null; state: string | null;
      googleRating: number | null; reviewCount: number | null; status: string;
    }>;

    if (opts.id) {
      const biz = await prisma.business.findUniqueOrThrow({
        where: { id: opts.id },
        select: { id: true, name: true, city: true, state: true, googleRating: true, reviewCount: true, status: true },
      });
      businesses = [biz];
    } else {
      businesses = await prisma.business.findMany({
        where: { status: { in: ["enriched", "qualified"] } },
        orderBy: { reviewCount: "desc" },
        take: parseInt(opts.limit, 10),
        select: { id: true, name: true, city: true, state: true, googleRating: true, reviewCount: true, status: true },
      });
    }

    if (businesses.length === 0) {
      console.log("No businesses ready for publishing (need enriched or qualified status).");
      await shutdown();
      return;
    }

    console.log(`\n  PUBLISH — ${businesses.length} businesses\n`);

    const globalStart = Date.now();
    const results: Array<{ name: string; city: string | null; url: string; size: number; time: string }> = [];
    let skipped = 0;

    for (let i = 0; i < businesses.length; i++) {
      const biz = businesses[i];
      const label = progress(i + 1, businesses.length, globalStart);
      const startTime = Date.now();

      try {
        // Score if needed (enriched → qualified/disqualified)
        if (biz.status === "enriched") {
          const full = await prisma.business.findUniqueOrThrow({ where: { id: biz.id } });
          const scoreResult = scoreBusiness({
            googleRating: full.googleRating ? Number(full.googleRating) : null,
            reviewCount: full.reviewCount,
            websiteScore: full.websiteScore,
            hasWebsite: full.hasWebsite ?? false,
          });

          await prisma.business.update({
            where: { id: biz.id },
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

          if (!scoreResult.qualified) {
            log("PUBLISH", `${label} ${biz.name} — disqualified (score: ${scoreResult.totalScore}), skipping`);
            skipped++;
            continue;
          }
          log("PUBLISH", `${label} ${biz.name} — scored ${scoreResult.totalScore}/100, qualified`);
        }

        // Ensure reviews
        const bizFull = await prisma.business.findUniqueOrThrow({ where: { id: biz.id } });
        if (!bizFull.reviews && serpApiKey && (bizFull.googleDataId || bizFull.googlePlaceId)) {
          log("PUBLISH", `${label} Fetching reviews...`);
          const reviews = await fetchGoogleReviews({
            dataId: bizFull.googleDataId,
            placeId: bizFull.googlePlaceId,
            apiKey: serpApiKey,
            maxReviews: 5,
          });
          await prisma.business.update({
            where: { id: biz.id },
            data: {
              reviews: JSON.parse(JSON.stringify(reviews)),
              googleMapsUrl: bizFull.googleMapsUrl ?? `https://www.google.com/maps/place/?q=place_id:${bizFull.googlePlaceId}`,
            },
          });
        }

        // Generate page
        const enriched = await prisma.business.findUniqueOrThrow({ where: { id: biz.id } });
        log("PUBLISH", `${label} Generating page for ${biz.name}...`);
        const html = await generatePage(enriched);
        log("PUBLISH", `${label} HTML: ${html.length} bytes`);

        // Validate
        if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
          throw new Error("Generated HTML missing doctype/html tag");
        }
        if (!html.includes("</html>")) {
          throw new Error("Generated HTML missing closing </html> tag");
        }

        // Upload to Supabase Storage
        const slug = generateSlug(biz.name, biz.city, biz.id);
        const filePath = `${slug}.html`;
        await supabase.storage.createBucket("preview-pages", { public: true });
        const body = new Blob([html], { type: "text/html" });
        const { error: uploadError } = await supabase.storage
          .from("preview-pages")
          .upload(filePath, body, { contentType: "text/html", upsert: true });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

        const { data: urlData } = supabase.storage.from("preview-pages").getPublicUrl(filePath);
        const htmlUrl = urlData.publicUrl;
        const previewUrl = `${previewBaseUrl}/${slug}`;

        const previewPage = await prisma.previewPage.upsert({
          where: { slug },
          update: {
            aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
            htmlUrl, previewUrl,
          },
          create: {
            businessId: biz.id, slug, templateId: "ai-generated",
            aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
            htmlUrl, previewUrl,
          },
        });

        await prisma.business.update({
          where: { id: biz.id },
          data: { status: "page_generated" },
        });

        // Deploy to R2
        log("PUBLISH", `${label} Deploying to R2...`);
        const { deployedUrl, r2Keys } = await deployToCloudflare(slug, html, [], biz.name);
        log("PUBLISH", `${label} ${r2Keys.length} files → ${deployedUrl}`);

        await prisma.intentPage.upsert({
          where: { slug },
          update: {
            aiContent: previewPage.aiContent as object,
            htmlUrl, deployedUrl,
          },
          create: {
            businessId: biz.id, slug,
            templateId: previewPage.templateId,
            aiContent: previewPage.aiContent as object,
            htmlUrl, deployedUrl,
          },
        });

        await prisma.business.update({
          where: { id: biz.id },
          data: { status: "page_deployed" },
        });

        const time = ((Date.now() - startTime) / 1000).toFixed(1);
        results.push({ name: biz.name, city: biz.city, url: deployedUrl, size: html.length, time });
      } catch (err) {
        log("PUBLISH", `${label} FAILED: ${biz.name} — ${err}`);
      }
    }

    const totalElapsed = formatDuration(Date.now() - globalStart);
    const failedCount = businesses.length - results.length - skipped;

    console.log("\n  RESULTS");
    console.log("  ───────");
    for (const r of results) {
      console.log(`  ${r.name} (${r.city}) → ${r.url} (${r.size}b, ${r.time}s)`);
    }
    console.log(`\n  Published: ${results.length} | Skipped: ${skipped} | Failed: ${failedCount} | Total: ${totalElapsed}`);
    await shutdown();
  });

// ─── pipeline ────────────────────────────────────────────────

program
  .command("pipeline")
  .description("Full pipeline: enrich + score what needs it, then publish")
  .option("-l, --limit <n>", "max businesses to process", "100")
  .action(async (opts) => {
    const { execFileSync } = await import("node:child_process");
    const cliPath = join(__dirname, "cli.ts");
    const limit = opts.limit;

    // Step 1: Enrich all discovered businesses
    const discovered = await prisma.business.count({ where: { status: "discovered" } });

    if (discovered > 0) {
      console.log(`\n  Step 1: Enriching ${Math.min(discovered, parseInt(limit, 10))} discovered businesses...\n`);
      execFileSync("npx", ["tsx", cliPath, "enrich", "-l", limit], {
        stdio: "inherit",
        env: process.env,
        cwd: join(__dirname, ".."),
      });
    } else {
      console.log("\n  Step 1: No discovered businesses to enrich — skipping");
    }

    // Step 2: Publish all qualified businesses
    const publishable = await prisma.business.count({
      where: { status: { in: ["enriched", "qualified"] } },
    });

    if (publishable > 0) {
      console.log(`\n  Step 2: Publishing ${Math.min(publishable, parseInt(limit, 10))} businesses...\n`);
      execFileSync("npx", ["tsx", cliPath, "publish", "-l", limit], {
        stdio: "inherit",
        env: process.env,
        cwd: join(__dirname, ".."),
      });
    } else {
      console.log("  Step 2: No businesses ready for publishing — skipping");
    }

    console.log("\n  Pipeline complete.");
    await shutdown();
  });

// ─── status ──────────────────────────────────────────────────

program
  .command("status")
  .description("Show pipeline status counts")
  .action(async () => {
    const statuses = await prisma.business.groupBy({
      by: ["status"],
      _count: { id: true },
      orderBy: { status: "asc" },
    });

    const total = statuses.reduce((sum, s) => sum + s._count.id, 0);
    const markets = await prisma.market.count({ where: { active: true } });

    console.log("\n  PIPELINE STATUS");
    console.log("  ───────────────");
    console.log(`  Active markets: ${markets}`);
    console.log(`  Total businesses: ${total}\n`);

    const order = [
      "discovered", "enriched", "qualified", "disqualified",
      "page_generated", "page_deployed",
      "outreach_scheduled", "outreach_sent",
      "replied", "no_reply", "bounced", "unsubscribed", "converted",
    ];

    for (const status of order) {
      const entry = statuses.find((s) => s.status === status);
      if (entry) {
        console.log(`  ${status.padEnd(20)} ${entry._count.id}`);
      }
    }

    // Show any statuses not in the predefined order
    for (const entry of statuses) {
      if (!order.includes(entry.status)) {
        console.log(`  ${entry.status.padEnd(20)} ${entry._count.id}`);
      }
    }

    console.log();
    await shutdown();
  });

// ─── Market parser (from sync-markets) ──────────────────────

interface ParsedMarket {
  industry: string;
  city: string;
  state: string;
  opportunityScore: number;
  marketSize: string;
  digitalGap: string;
  notes: string;
}

interface ParsedCity {
  city: string;
  state: string;
  cityScore: number;
  markets: ParsedMarket[];
}

const STATE_ABBREV: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
};

function parseDataMd(content: string): ParsedCity[] {
  const cities: ParsedCity[] = [];
  const cityPattern = /###\s*\d+\.\s*(.+?),\s*(.+?),\s*USA\s*\(Score:\s*(\d+)\)/g;
  const cityMatches = [...content.matchAll(cityPattern)];

  for (let i = 0; i < cityMatches.length; i++) {
    const match = cityMatches[i];
    const city = match[1].trim();
    const state = STATE_ABBREV[match[2].trim()] ?? match[2].trim();
    const cityScore = parseInt(match[3], 10);

    const sectionStart = match.index! + match[0].length;
    const sectionEnd = i + 1 < cityMatches.length ? cityMatches[i + 1].index! : content.length;
    const section = content.slice(sectionStart, sectionEnd);

    const rows: ParsedMarket[] = [];
    const lines = section.split("\n");
    let inTable = false;
    let headerSkipped = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) { inTable = false; headerSkipped = false; continue; }
      if (!inTable) { inTable = true; headerSkipped = false; continue; }
      if (!headerSkipped) {
        if (trimmed.includes("---")) { headerSkipped = true; continue; }
      }

      const cells = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 5) {
        const score = parseInt(cells[1], 10);
        if (!isNaN(score)) {
          rows.push({
            industry: cells[0].toLowerCase().trim(),
            city, state,
            opportunityScore: score,
            marketSize: cells[2].trim(),
            digitalGap: cells[3].trim(),
            notes: cells[4].trim(),
          });
        }
      }
    }

    cities.push({ city, state, cityScore, markets: rows });
  }

  return cities;
}

async function loadActiveMarkets(): Promise<Array<{ industry: string; city: string; state: string }>> {
  const markets = await prisma.market.findMany({
    where: { active: true },
    orderBy: { opportunityScore: "desc" },
    select: { industry: true, city: true, state: true },
  });

  if (markets.length === 0) {
    console.error("No active markets in DB. Run `sync-markets` first.");
    process.exit(1);
  }

  return markets;
}

// ─── Run ─────────────────────────────────────────────────────

program
  .name("lead-gen")
  .description("Lead generation pipeline CLI")
  .version("1.0.0");

program.parseAsync().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

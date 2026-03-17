/**
 * Script 2: Page-Gen + Deploy only.
 *
 * Picks enriched/qualified businesses, scores them, generates pages
 * via Claude CLI, and deploys to R2.
 *
 * Usage:
 *   npx tsx scripts/run-pagegen-deploy.ts          # process all qualified businesses
 *   npx tsx scripts/run-pagegen-deploy.ts 3         # process up to 3
 *   npx tsx scripts/run-pagegen-deploy.ts <id>      # process a specific business by ID
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { generatePage } from "../workers/page-gen/src/ai-content.js";
import { fetchGoogleReviews } from "../workers/enrichment/src/fetch-reviews.js";
import { scoreBusiness } from "../workers/scoring/src/score.js";
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

// ─── Score a business if needed ──────────────────────────────
async function ensureQualified(businessId: string): Promise<boolean> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  if (business.status === "qualified" || business.status === "page_generated" || business.status === "page_deployed") {
    return true;
  }

  if (business.status === "enriched") {
    log("SCORING", `Scoring ${business.name}...`);
    const result = scoreBusiness({
      googleRating: business.googleRating ? Number(business.googleRating) : null,
      reviewCount: business.reviewCount,
      websiteScore: business.websiteScore,
      hasWebsite: business.hasWebsite ?? false,
    });

    log("SCORING", `  Score: ${result.totalScore}/100 | Qualified: ${result.qualified}`);

    await prisma.business.update({
      where: { id: businessId },
      data: {
        status: result.qualified ? "qualified" : "disqualified",
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

    return result.qualified;
  }

  if (business.status === "discovered") {
    // Fast-forward to qualified for testing
    log("SCORING", `Fast-forwarding ${business.name} to qualified (was: discovered)`);
    await prisma.business.update({
      where: { id: businessId },
      data: { status: "qualified" },
    });
    return true;
  }

  return false;
}

// ─── Process a single business ───────────────────────────────
async function processOneBusiness(
  business: { id: string; name: string; city: string | null; state: string | null; googleRating: number | null; reviewCount: number | null },
  index: number,
  total: number,
): Promise<{ name: string; city: string | null; deployedUrl: string; htmlSize: number; totalTime: string }> {
  const label = `[${index + 1}/${total}]`;
  log("SETUP", `${label} ${business.name} (${business.city}, ${business.state})`);

  const originalStatus = (await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).status;
  const startTime = Date.now();

  try {
    // Score if needed
    const qualified = await ensureQualified(business.id);
    if (!qualified) {
      throw new Error(`Business disqualified — skipping`);
    }

    // Ensure reviews are fetched
    const serpApiKey = process.env.SERP_API_KEY;
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });

    if (!biz.reviews && serpApiKey && (biz.googleDataId || biz.googlePlaceId)) {
      log("REVIEWS", `${label} Fetching Google reviews...`);
      const reviews = await fetchGoogleReviews({
        dataId: biz.googleDataId,
        placeId: biz.googlePlaceId,
        apiKey: serpApiKey,
        maxReviews: 5,
      });
      log("REVIEWS", `${label} Got ${reviews.length} reviews`);
      await prisma.business.update({
        where: { id: business.id },
        data: {
          reviews: JSON.parse(JSON.stringify(reviews)),
          googleMapsUrl: biz.googleMapsUrl ?? `https://www.google.com/maps/place/?q=place_id:${biz.googlePlaceId}`,
        },
      });
    }

    // Reload with reviews
    const enrichedBusiness = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });

    // Page generation
    log("PAGE-GEN", `${label} Generating HTML via Claude CLI...`);
    const html = await generatePage(enrichedBusiness);
    log("PAGE-GEN", `${label} HTML generated (${html.length} bytes)`);

    // Validate
    if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
      throw new Error("Generated HTML missing doctype/html tag");
    }
    if (!html.includes("</html>")) {
      throw new Error("Generated HTML missing closing </html> tag");
    }

    // Upload to Supabase Storage
    log("PAGE-GEN", `${label} Uploading to Supabase Storage...`);
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const slug = generateSlug(business.name, business.city, business.id);
    const filePath = `${slug}.html`;

    await supabase.storage.createBucket("preview-pages", { public: true });
    const body = new Blob([html], { type: "text/html" });
    const { error: uploadError } = await supabase.storage
      .from("preview-pages")
      .upload(filePath, body, { contentType: "text/html", upsert: true });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: urlData } = supabase.storage.from("preview-pages").getPublicUrl(filePath);
    const htmlUrl = urlData.publicUrl;
    log("PAGE-GEN", `${label} Uploaded: ${htmlUrl}`);

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

    const pageGenTime = Date.now();
    log("PAGE-GEN", `${label} Completed in ${((pageGenTime - startTime) / 1000).toFixed(1)}s`);

    // Deploy to R2
    log("DEPLOY", `${label} Deploying slug: ${slug}`);
    const { deployedUrl, r2Keys } = await deployToCloudflare(slug, html, [], business.name);
    log("DEPLOY", `${label} Uploaded ${r2Keys.length} files to R2`);
    log("DEPLOY", `${label} ${deployedUrl}`);

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

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    return { name: business.name, city: business.city, deployedUrl, htmlSize: html.length, totalTime };
  } catch (err) {
    log("CLEANUP", `${label} Restoring status to "${originalStatus}"`);
    await prisma.business.update({
      where: { id: business.id },
      data: { status: originalStatus },
    });
    throw err;
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2];

  // Determine which businesses to process
  let businesses: Array<{ id: string; name: string; city: string | null; state: string | null; googleRating: number | null; reviewCount: number | null }>;

  // Check if arg is a UUID
  const isUuid = arg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg);

  if (isUuid) {
    const biz = await prisma.business.findUniqueOrThrow({
      where: { id: arg },
      select: { id: true, name: true, city: true, state: true, googleRating: true, reviewCount: true },
    });
    businesses = [biz];
  } else {
    const limit = parseInt(arg ?? "100", 10);
    businesses = await prisma.business.findMany({
      where: { status: { in: ["discovered", "enriched", "qualified"] } },
      orderBy: { reviewCount: "desc" },
      take: limit,
      select: { id: true, name: true, city: true, state: true, googleRating: true, reviewCount: true },
    });
  }

  if (businesses.length === 0) {
    console.error("No eligible businesses found (discovered/enriched/qualified).");
    process.exit(1);
  }

  console.log("\n========================================");
  console.log(`  PAGE-GEN + DEPLOY (${businesses.length} businesses)`);
  console.log("========================================\n");

  const results: Array<Awaited<ReturnType<typeof processOneBusiness>>> = [];
  const globalStart = Date.now();

  for (let i = 0; i < businesses.length; i++) {
    try {
      const result = await processOneBusiness(businesses[i], i, businesses.length);
      results.push(result);
    } catch (err) {
      log("ERROR", `Failed: ${businesses[i].name} — ${err}`);
    }
  }

  const totalElapsed = ((Date.now() - globalStart) / 1000).toFixed(1);

  console.log("\n========================================");
  console.log("  DONE!");
  console.log("========================================");
  for (const r of results) {
    console.log(`\n  ${r.name} (${r.city})`);
    console.log(`    Live:   ${r.deployedUrl}`);
    console.log(`    HTML:   ${r.htmlSize} bytes`);
    console.log(`    Time:   ${r.totalTime}s`);
  }
  console.log(`\n  Processed: ${results.length}/${businesses.length} | Total: ${totalElapsed}s`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

/**
 * Test Script — Page-Gen + Deploy only.
 *
 * Picks a discovered business, fast-forwards it to "qualified",
 * then runs page generation (Claude CLI) and Cloudflare deployment.
 * Restores original status on failure.
 *
 * Usage: npx tsx scripts/test-pagegen-deploy.ts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { generatePage } from "../workers/page-gen/src/ai-content.js";
import { fetchGoogleReviews } from "../workers/enrichment/src/fetch-reviews.js";
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

const BATCH_SIZE = parseInt(process.argv[2] ?? "3", 10);

async function processOneBusiness(
  business: Awaited<ReturnType<typeof prisma.business.findFirstOrThrow>>,
  index: number,
) {
  const label = `[${index + 1}/${BATCH_SIZE}]`;
  const originalStatus = business.status;

  log("SETUP", `${label} ${business.name} (${business.city}, ${business.state})`);
  log("SETUP", `${label} Rating: ${business.googleRating}/5 | Reviews: ${business.reviewCount}`);

  // Fast-forward to qualified
  await prisma.business.update({
    where: { id: business.id },
    data: { status: "qualified" },
  });

  const startTime = Date.now();

  try {
    // ── Step 0: Fetch real Google reviews ──
    console.log(`\n--- ${label} Fetching Google Reviews ---`);
    const serpApiKey = process.env.SERP_API_KEY;
    let reviews: Awaited<ReturnType<typeof fetchGoogleReviews>> = [];

    if (serpApiKey && (business.googleDataId || business.googlePlaceId)) {
      log("REVIEWS", `${label} Fetching reviews for place_id: ${business.googlePlaceId}`);
      reviews = await fetchGoogleReviews({
        dataId: business.googleDataId,
        placeId: business.googlePlaceId,
        apiKey: serpApiKey,
        maxReviews: 5,
      });
      log("REVIEWS", `${label} Got ${reviews.length} reviews`);
      for (const r of reviews) {
        log("REVIEWS", `  ${r.rating}/5 by ${r.author}: "${r.text.slice(0, 80)}..."`);
      }

      await prisma.business.update({
        where: { id: business.id },
        data: {
          reviews: reviews,
          googleMapsUrl: business.googleMapsUrl ?? `https://www.google.com/maps/place/?q=place_id:${business.googlePlaceId}`,
        },
      });
    } else {
      log("REVIEWS", `${label} Skipping — no SERP_API_KEY or no place identifier`);
    }

    // Reload business with reviews
    const enrichedBusiness = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
    });

    // ── Step 1: Page Generation ──
    console.log(`\n--- ${label} Page Generation (Claude CLI) ---`);
    log("PAGE-GEN", `${label} Generating full HTML page via Claude CLI...`);

    const html = await generatePage(enrichedBusiness);
    log("PAGE-GEN", `${label} HTML generated (${html.length} bytes)`);

    // Quick validation
    if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
      throw new Error("Generated HTML missing doctype/html tag");
    }
    if (!html.includes("</html>")) {
      throw new Error("Generated HTML missing closing </html> tag");
    }
    if (!html.includes("tailwindcss")) {
      log("PAGE-GEN", `${label} Warning: Tailwind CDN not found in output`);
    }
    if (!html.includes("lucide")) {
      log("PAGE-GEN", `${label} Warning: Lucide CDN not found in output`);
    }
    log("PAGE-GEN", `${label} HTML validation passed`);

    // ── Upload to Supabase Storage ──
    log("PAGE-GEN", `${label} Uploading to Supabase Storage...`);
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const slug = generateSlug(business.name, business.city, business.id);
    const filePath = `${slug}.html`;

    await supabase.storage.createBucket("preview-pages", { public: true });

    const { error: uploadError } = await supabase.storage
      .from("preview-pages")
      .upload(filePath, html, { contentType: "text/html", upsert: true });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: urlData } = supabase.storage.from("preview-pages").getPublicUrl(filePath);
    const htmlUrl = urlData.publicUrl;
    log("PAGE-GEN", `${label} Uploaded: ${htmlUrl}`);

    const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? "https://lead-gen-3lm.pages.dev";
    const previewUrl = `${previewBaseUrl}/${slug}`;

    const previewPage = await prisma.previewPage.upsert({
      where: { slug },
      update: {
        aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
        htmlUrl,
        previewUrl,
      },
      create: {
        businessId: business.id,
        slug,
        templateId: "ai-generated",
        aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
        htmlUrl,
        previewUrl,
      },
    });

    await prisma.business.update({
      where: { id: business.id },
      data: { status: "page_generated" },
    });

    const pageGenTime = Date.now();
    log("PAGE-GEN", `${label} Completed in ${((pageGenTime - startTime) / 1000).toFixed(1)}s`);

    // ── Step 2: Deploy to Cloudflare R2 ──
    console.log(`\n--- ${label} Deploy to Cloudflare R2 ---`);
    log("DEPLOY", `${label} Deploying slug: ${slug}`);

    const { deployedUrl, r2Keys } = await deployToCloudflare(slug, html, [], business.name);
    log("DEPLOY", `${label} R2 keys: ${r2Keys.length} files`);
    log("DEPLOY", `${label} Deployed URL: ${deployedUrl}`);

    await prisma.intentPage.upsert({
      where: { slug },
      update: {
        aiContent: previewPage.aiContent as object,
        htmlUrl,
        deployedUrl,
      },
      create: {
        businessId: business.id,
        slug,
        templateId: previewPage.templateId,
        aiContent: previewPage.aiContent as object,
        htmlUrl,
        deployedUrl,
      },
    });

    await prisma.business.update({
      where: { id: business.id },
      data: { status: "page_deployed" },
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const deployTime = ((Date.now() - pageGenTime) / 1000).toFixed(1);

    return {
      name: business.name,
      city: business.city,
      deployedUrl,
      previewUrl,
      reviewCount: reviews.length,
      htmlSize: html.length,
      pageGenTime: ((pageGenTime - startTime) / 1000).toFixed(1),
      deployTime,
      totalTime,
    };
  } catch (err) {
    log("CLEANUP", `${label} Restoring status to "${originalStatus}"`);
    await prisma.business.update({
      where: { id: business.id },
      data: { status: originalStatus },
    });
    throw err;
  }
}

async function main() {
  console.log("\n========================================");
  console.log(`  PAGE-GEN + DEPLOY TEST (${BATCH_SIZE} businesses)`);
  console.log("========================================\n");

  const businesses = await prisma.business.findMany({
    where: { status: { in: ["discovered", "enriched", "qualified"] } },
    orderBy: { reviewCount: "desc" },
    take: BATCH_SIZE,
  });

  if (businesses.length === 0) {
    console.error("No discovered/enriched/qualified businesses in DB to test with.");
    process.exit(1);
  }

  log("SETUP", `Found ${businesses.length} businesses to process`);

  const results: Array<Awaited<ReturnType<typeof processOneBusiness>>> = [];
  const globalStart = Date.now();

  for (let i = 0; i < businesses.length; i++) {
    const result = await processOneBusiness(businesses[i], i);
    results.push(result);
  }

  // Final summary
  const totalElapsed = ((Date.now() - globalStart) / 1000).toFixed(1);
  console.log("\n========================================");
  console.log("  ALL DONE!");
  console.log("========================================");
  for (const r of results) {
    console.log(`\n  ${r.name} (${r.city})`);
    console.log(`    Live:      ${r.deployedUrl}`);
    console.log(`    Reviews:   ${r.reviewCount} real Google reviews`);
    console.log(`    HTML:      ${r.htmlSize} bytes`);
    console.log(`    Timing:    page-gen ${r.pageGenTime}s + deploy ${r.deployTime}s = ${r.totalTime}s`);
  }
  console.log(`\n  Total elapsed: ${totalElapsed}s`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

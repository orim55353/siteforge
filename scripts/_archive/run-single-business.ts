/**
 * Run page-gen + deploy for a single business by ID.
 *
 * Usage: npx tsx scripts/run-single-business.ts <businessId>
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

const businessId = process.argv[2];
if (!businessId) {
  console.error("Usage: npx tsx scripts/run-single-business.ts <businessId>");
  process.exit(1);
}

async function main() {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  const originalStatus = business.status;

  console.log("\n========================================");
  console.log(`  PAGE-GEN + DEPLOY: ${business.name}`);
  console.log("========================================\n");

  log("SETUP", `${business.name} (${business.city}, ${business.state})`);
  log("SETUP", `Rating: ${business.googleRating}/5 | Reviews: ${business.reviewCount}`);
  log("SETUP", `Current status: ${business.status}`);

  // Fast-forward to qualified
  await prisma.business.update({
    where: { id: business.id },
    data: { status: "qualified" },
  });

  const startTime = Date.now();

  try {
    // ── Step 0: Fetch real Google reviews ──
    console.log("\n--- Fetching Google Reviews ---");
    const serpApiKey = process.env.SERP_API_KEY;
    let reviews: Awaited<ReturnType<typeof fetchGoogleReviews>> = [];

    if (serpApiKey && (business.googleDataId || business.googlePlaceId)) {
      log("REVIEWS", `Fetching reviews for place_id: ${business.googlePlaceId}`);
      reviews = await fetchGoogleReviews({
        dataId: business.googleDataId,
        placeId: business.googlePlaceId,
        apiKey: serpApiKey,
        maxReviews: 5,
      });
      log("REVIEWS", `Got ${reviews.length} reviews`);
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
      log("REVIEWS", "Skipping — no SERP_API_KEY or no place identifier");
    }

    // Reload business with reviews
    const enrichedBusiness = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
    });

    // ── Step 1: Page Generation ──
    console.log("\n--- Page Generation (Claude CLI) ---");
    log("PAGE-GEN", "Generating full HTML page via Claude CLI...");

    const html = await generatePage(enrichedBusiness);
    log("PAGE-GEN", `HTML generated (${html.length} bytes)`);

    // Quick validation
    if (!html.includes("<!DOCTYPE html") && !html.includes("<html")) {
      throw new Error("Generated HTML missing doctype/html tag");
    }
    if (!html.includes("</html>")) {
      throw new Error("Generated HTML missing closing </html> tag");
    }
    if (!html.includes("tailwindcss")) {
      log("PAGE-GEN", "Warning: Tailwind CDN not found in output");
    }
    if (!html.includes("lucide")) {
      log("PAGE-GEN", "Warning: Lucide CDN not found in output");
    }
    log("PAGE-GEN", "HTML validation passed");

    // ── Upload to Supabase Storage ──
    log("PAGE-GEN", "Uploading to Supabase Storage...");
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
    log("PAGE-GEN", `Uploaded: ${htmlUrl}`);

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
    log("PAGE-GEN", `Completed in ${((pageGenTime - startTime) / 1000).toFixed(1)}s`);

    // ── Step 2: Deploy to Cloudflare R2 ──
    console.log("\n--- Deploy to Cloudflare R2 ---");
    log("DEPLOY", `Deploying slug: ${slug}`);

    const { deployedUrl, r2Keys } = await deployToCloudflare(slug, html, [], business.name);
    log("DEPLOY", `R2 keys: ${r2Keys.length} files`);
    log("DEPLOY", `Deployed URL: ${deployedUrl}`);

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
    const deployTimeStr = ((Date.now() - pageGenTime) / 1000).toFixed(1);

    console.log("\n========================================");
    console.log("  DONE!");
    console.log("========================================");
    console.log(`\n  ${business.name} (${business.city}, ${business.state})`);
    console.log(`    Live:      ${deployedUrl}`);
    console.log(`    Preview:   ${previewUrl}`);
    console.log(`    Reviews:   ${reviews.length} real Google reviews`);
    console.log(`    HTML:      ${html.length} bytes`);
    console.log(`    Timing:    page-gen ${((pageGenTime - startTime) / 1000).toFixed(1)}s + deploy ${deployTimeStr}s = ${totalTime}s`);
    console.log("========================================\n");
  } catch (err) {
    log("CLEANUP", `Restoring status to "${originalStatus}"`);
    await prisma.business.update({
      where: { id: business.id },
      data: { status: originalStatus },
    });
    throw err;
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

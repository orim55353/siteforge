/**
 * E2E Test Script — runs the full pipeline for 1 business.
 *
 * Uses the actual worker logic (not inline copies).
 * Caches SerpAPI discovery results in Supabase for 1 day to save API calls.
 * Overrides the outreach email to the test address.
 *
 * Usage: npx tsx scripts/e2e-test.ts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { Resend } from "resend";

// Worker logic imports (pure functions, no BullMQ dependency)
import { searchPlaces, type PlaceResult } from "../workers/discovery/src/serp-places.js";
import { auditWebsite } from "../workers/enrichment/src/website-audit.js";
import { normalizePhone } from "../workers/enrichment/src/phone-utils.js";
import { timezoneFromState } from "../workers/enrichment/src/timezone-lookup.js";
import { scoreBusiness } from "../workers/scoring/src/score.js";
import { generatePage } from "../workers/page-gen/src/ai-content.js";
import { deployToCloudflare } from "../workers/deploy/src/cloudflare.js";
import { createClient } from "@supabase/supabase-js";

// ─── Config ───────────────────────────────────────────────────
const TEST_EMAIL = "orim553@gmail.com";
const INDUSTRY = "dentist";
const CITY = "Austin";
const STATE = "TX";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

// ─── Clients ──────────────────────────────────────────────────
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

// ─── Step 1: Discovery (with cache) ──────────────────────────
async function discover(marketId: string): Promise<string> {
  const query = `${INDUSTRY} in ${CITY}, ${STATE}`;
  log("DISCOVERY", `Query: "${query}"`);

  // Check cache first
  const cached = await prisma.discoveryCache.findUnique({ where: { query } });
  const cacheAge = cached ? Date.now() - cached.createdAt.getTime() : Infinity;

  let places: PlaceResult[];

  if (cached && cacheAge < CACHE_MAX_AGE_MS) {
    log("DISCOVERY", `Using cached results (age: ${Math.round(cacheAge / 60_000)}m)`);
    const raw = cached.results as Array<Record<string, unknown>>;
    places = raw.map((r) => ({
      place_id: r.place_id as string,
      name: r.name as string,
      formatted_address: r.formatted_address as string | undefined,
      formatted_phone_number: r.formatted_phone_number as string | undefined,
      website: r.website as string | undefined,
      rating: r.rating as number | undefined,
      user_ratings_total: r.user_ratings_total as number | undefined,
      geometry: r.geometry as { location: { lat: number; lng: number } } | undefined,
      types: r.types as string[] | undefined,
      address_components: r.address_components as PlaceResult["address_components"],
    }));
  } else {
    const apiKey = process.env.SERP_API_KEY;
    if (!apiKey) throw new Error("SERP_API_KEY is not set");

    log("DISCOVERY", "Calling SerpAPI...");
    places = await searchPlaces(query, apiKey, 5); // Only 5 for testing
    log("DISCOVERY", `Found ${places.length} results`);

    // Save to cache (upsert)
    await prisma.discoveryCache.upsert({
      where: { query },
      update: { results: JSON.parse(JSON.stringify(places)), createdAt: new Date() },
      create: { query, results: JSON.parse(JSON.stringify(places)) },
    });
    log("DISCOVERY", "Cached results for next run");
  }

  if (places.length === 0) throw new Error("No results from SerpAPI");

  // Pick the first result
  const place = places[0];
  log("DISCOVERY", `Selected: ${place.name} (${place.rating}* / ${place.user_ratings_total} reviews)`);

  // Check if already in DB
  const existing = await prisma.business.findUnique({
    where: { googlePlaceId: place.place_id },
  });

  if (existing) {
    log("DISCOVERY", `Already in DB (id: ${existing.id}), resetting to "discovered"`);
    await prisma.business.update({
      where: { id: existing.id },
      data: { status: "discovered", email: TEST_EMAIL },
    });
    return existing.id;
  }

  const business = await prisma.business.create({
    data: {
      marketId,
      status: "discovered",
      googlePlaceId: place.place_id,
      name: place.name,
      phone: place.formatted_phone_number ?? null,
      email: TEST_EMAIL,
      website: place.website ?? null,
      address: place.formatted_address ?? null,
      city: CITY,
      state: STATE,
      latitude: place.geometry?.location.lat ?? null,
      longitude: place.geometry?.location.lng ?? null,
      googleRating: place.rating ?? null,
      reviewCount: place.user_ratings_total ?? 0,
      categories: place.types ?? [],
    },
  });

  log("DISCOVERY", `Created business: ${business.id}`);
  return business.id;
}

// ─── Step 2: Enrichment ──────────────────────────────────────
async function enrich(businessId: string) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  log("ENRICHMENT", `Enriching: ${business.name}`);

  let hasWebsite = false;
  let websiteScore: number | null = null;
  let hasSsl = false;
  let isMobileFriendly = false;
  let hasOnlineBooking = false;
  let techStack: string[] = [];
  let socialProfiles: Record<string, string> = {};

  if (business.website) {
    log("ENRICHMENT", `Auditing website: ${business.website}`);
    const audit = await auditWebsite(business.website);
    hasWebsite = audit.loads;
    websiteScore = audit.score;
    hasSsl = audit.hasSsl;
    isMobileFriendly = audit.isMobileFriendly;
    hasOnlineBooking = audit.hasOnlineBooking;
    techStack = audit.techStack;
    socialProfiles = audit.socialProfiles;
    log("ENRICHMENT", `Website score: ${audit.score}/100 (loads: ${audit.loads})`);
  } else {
    log("ENRICHMENT", "No website — skipping audit");
  }

  const normalizedPhone = business.phone ? normalizePhone(business.phone) : null;
  const timezone = business.state ? timezoneFromState(business.state) : "America/Chicago";

  await prisma.business.update({
    where: { id: businessId },
    data: {
      status: "enriched",
      hasWebsite,
      websiteScore,
      hasSsl,
      isMobileFriendly,
      hasOnlineBooking,
      techStack,
      socialProfiles,
      phone: normalizedPhone ?? business.phone,
      timezone,
      email: TEST_EMAIL,
    },
  });

  log("ENRICHMENT", `Done — status: enriched, timezone: ${timezone}`);
}

// ─── Step 3: Scoring ─────────────────────────────────────────
async function score(businessId: string): Promise<boolean> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  log("SCORING", `Scoring: ${business.name}`);

  const result = scoreBusiness({
    googleRating: business.googleRating ? Number(business.googleRating) : null,
    reviewCount: business.reviewCount,
    websiteScore: business.websiteScore,
    hasWebsite: business.hasWebsite ?? false,
  });

  log("SCORING", `Score: ${result.totalScore}/100 | Rating: ${result.ratingScore} Reviews: ${result.reviewScore} Website: ${result.websiteScore}`);
  log("SCORING", `Qualified: ${result.qualified}${result.reasons.length ? ` (reasons: ${result.reasons.join(", ")})` : ""}`);

  const newStatus = result.qualified ? "qualified" : "disqualified";

  await prisma.business.update({
    where: { id: businessId },
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

  if (!result.qualified) {
    log("SCORING", "Business disqualified — forcing qualification for testing");
    await prisma.business.update({
      where: { id: businessId },
      data: { status: "qualified", score: result.totalScore },
    });
    return true;
  }

  return result.qualified;
}

// ─── Step 4: Page Generation (Claude CLI → full HTML) ────────
async function genPage(businessId: string): Promise<{ previewPageId: string; slug: string }> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { market: true },
  });

  log("PAGE-GEN", `Generating page for: ${business.name}`);

  // Use the actual worker's AI page generation (Claude CLI — single call, full HTML)
  log("PAGE-GEN", "Calling Claude CLI to generate full HTML page...");
  const html = await generatePage(business);
  log("PAGE-GEN", `HTML generated (${html.length} bytes)`);

  // Upload to Supabase Storage
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);
  const slug = generateSlug(business.name, business.city, businessId);
  const filePath = `${slug}.html`;

  const { error: bucketError } = await supabase.storage.createBucket("preview-pages", { public: true });
  if (bucketError && !bucketError.message.includes("already exists")) {
    log("PAGE-GEN", `Warning: bucket creation: ${bucketError.message}`);
  }

  const { error: uploadError } = await supabase.storage
    .from("preview-pages")
    .upload(filePath, html, { contentType: "text/html", upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from("preview-pages").getPublicUrl(filePath);
  const htmlUrl = urlData.publicUrl;
  log("PAGE-GEN", `Uploaded to Supabase: ${htmlUrl}`);

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
      businessId,
      slug,
      templateId: "ai-generated",
      aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
      htmlUrl,
      previewUrl,
    },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { status: "page_generated" },
  });

  log("PAGE-GEN", `Preview page: ${previewPage.id} | slug: ${slug}`);
  return { previewPageId: previewPage.id, slug };
}

// ─── Step 5: Deploy to Cloudflare ────────────────────────────
async function deploy(businessId: string, previewPageId: string): Promise<string> {
  const previewPage = await prisma.previewPage.findUniqueOrThrow({ where: { id: previewPageId } });
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  log("DEPLOY", `Deploying page for: ${business.name} (slug: ${previewPage.slug})`);

  // Fetch HTML from Supabase Storage
  const htmlRes = await fetch(previewPage.htmlUrl!);
  if (!htmlRes.ok) throw new Error(`Failed to fetch HTML: ${htmlRes.status}`);
  const html = await htmlRes.text();

  // Use the actual deploy worker's Cloudflare function
  const { deployedUrl, r2Keys } = await deployToCloudflare(previewPage.slug, html, [], business.name);
  log("DEPLOY", `Deployed to Cloudflare (${r2Keys.length} files): ${deployedUrl}`);

  // Create or update intent page
  await prisma.intentPage.upsert({
    where: { slug: previewPage.slug },
    update: {
      aiContent: previewPage.aiContent as object,
      htmlUrl: previewPage.htmlUrl!,
      deployedUrl,
    },
    create: {
      businessId,
      slug: previewPage.slug,
      templateId: previewPage.templateId,
      aiContent: previewPage.aiContent as object,
      htmlUrl: previewPage.htmlUrl!,
      deployedUrl,
    },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { status: "page_deployed" },
  });

  log("DEPLOY", "Status: page_deployed");
  return deployedUrl;
}

// ─── Step 6: Send Email ──────────────────────────────────────
async function sendEmail(businessId: string, deployedUrl: string) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  log("EMAIL", `Preparing outreach for: ${business.name}`);

  // Find or create test campaign
  let campaign = await prisma.campaign.findFirst({ where: { name: "E2E Test Campaign" } });
  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        name: "E2E Test Campaign",
        industry: INDUSTRY,
        subjectLine: "We built a free page for {{business.name}}",
        bodyTemplate: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Hi there!</h2>
  <p>We noticed <strong>{{business.name}}</strong> in {{business.city}} and thought you could use a better web presence.</p>
  <p>We went ahead and built a free landing page for you:</p>
  <p><a href="${deployedUrl}" style="display: inline-block; background: #0f3460; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none;">View Your Free Page</a></p>
  <p>If you like it, just reply to this email and we'll help you get it live.</p>
  <p>Best,<br>Lead Gen Team</p>
</div>`,
        active: true,
      },
    });
  }

  const subject = campaign.subjectLine
    .replace(/\{\{business\.name\}\}/g, business.name)
    .replace(/\{\{business\.city\}\}/g, business.city ?? "");

  const bodyHtml = campaign.bodyTemplate
    .replace(/\{\{business\.name\}\}/g, business.name)
    .replace(/\{\{business\.city\}\}/g, business.city ?? "");

  const fromEmail = process.env.FROM_EMAIL ?? "onboarding@resend.dev";

  // Check suppression
  const suppressed = await prisma.suppressionEntry.findUnique({ where: { email: TEST_EMAIL } });
  if (suppressed) {
    throw new Error(`${TEST_EMAIL} is on suppression list (${suppressed.reason})`);
  }

  // Create outreach message
  const outreachMessage = await prisma.outreachMessage.create({
    data: {
      businessId,
      campaignId: campaign.id,
      status: "scheduled",
      toEmail: TEST_EMAIL,
      fromEmail,
      subject,
      bodyHtml,
      scheduledFor: new Date(), // Immediately for testing
    },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { status: "outreach_scheduled" },
  });

  log("EMAIL", `Sending to: ${TEST_EMAIL} from: ${fromEmail}`);

  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: TEST_EMAIL,
    subject,
    html: bodyHtml,
    headers: { "X-Outreach-Message-Id": outreachMessage.id },
  });

  if (error) throw new Error(`Resend API error: ${error.message}`);
  if (!data?.id) throw new Error("Resend returned no message ID");

  log("EMAIL", `Sent! Resend ID: ${data.id}`);

  await prisma.outreachMessage.update({
    where: { id: outreachMessage.id },
    data: { resendId: data.id, status: "sent", sentAt: new Date() },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { status: "outreach_sent" },
  });

  log("EMAIL", "Status: outreach_sent");
}

// ─── Helpers ─────────────────────────────────────────────────
function generateSlug(name: string, city: string | null, id: string): string {
  const base = [name, city].filter(Boolean).join("-");
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${clean}-${id.slice(0, 8)}`;
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log("\n========================================");
  console.log("  LEAD GEN E2E TEST — Full Pipeline");
  console.log("  (using actual workers)");
  console.log("========================================\n");

  try {
    // Create or find test market
    let market = await prisma.market.findFirst({
      where: { industry: INDUSTRY, city: CITY, state: STATE },
    });
    if (!market) {
      market = await prisma.market.create({
        data: {
          name: `${INDUSTRY.charAt(0).toUpperCase() + INDUSTRY.slice(1)}s in ${CITY}, ${STATE}`,
          industry: INDUSTRY,
          city: CITY,
          state: STATE,
        },
      });
      log("SETUP", `Created market: ${market.id}`);
    } else {
      log("SETUP", `Using existing market: ${market.id}`);
    }

    // Step 1: Discovery
    console.log("\n--- Step 1: Discovery ---");
    const businessId = await discover(market.id);

    // Step 2: Enrichment
    console.log("\n--- Step 2: Enrichment ---");
    await enrich(businessId);

    // Step 3: Scoring
    console.log("\n--- Step 3: Scoring ---");
    await score(businessId);

    // Step 4: Page Generation (Claude CLI)
    console.log("\n--- Step 4: Page Generation ---");
    const { previewPageId } = await genPage(businessId);

    // Step 5: Deploy to Cloudflare
    console.log("\n--- Step 5: Deploy to Cloudflare ---");
    const deployedUrl = await deploy(businessId, previewPageId);

    // Step 6: Send Email
    console.log("\n--- Step 6: Send Email ---");
    await sendEmail(businessId, deployedUrl);

    // Final status
    const finalBusiness = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    console.log("\n========================================");
    console.log("  E2E TEST COMPLETE!");
    console.log("========================================");
    console.log(`  Business: ${finalBusiness.name}`);
    console.log(`  Status:   ${finalBusiness.status}`);
    console.log(`  Score:    ${finalBusiness.score}/100`);
    console.log(`  Page:     ${deployedUrl}`);
    console.log(`  Email:    sent to ${TEST_EMAIL}`);
    console.log("========================================\n");
  } catch (err) {
    console.error("\n[FATAL]", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

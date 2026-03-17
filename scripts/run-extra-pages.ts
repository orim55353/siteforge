/**
 * Test script — runs extra-pages generation for a single business.
 *
 * Usage: npx tsx scripts/run-extra-pages.ts <businessId>
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { buildBusinessContext } from "../packages/ai/src/business-context.js";
import { runClaude, extractHtml } from "../packages/ai/src/claude.js";
import { extractHead, graftHead } from "../workers/extra-pages/src/extract-config.js";
import { buildAboutPrompt, buildServicesPrompt, buildGalleryPrompt } from "../workers/extra-pages/src/prompts.js";
import { deployToCloudflare } from "../workers/deploy/src/cloudflare.js";
import { injectPageNav } from "../packages/templates/src/nav-injection.js";
import type { BusinessInput } from "../packages/ai/src/types.js";

const prisma = new PrismaClient();

const PAGE_TYPES = ["about", "services", "gallery"] as const;
type ExtraPageType = (typeof PAGE_TYPES)[number];

const PROMPT_BUILDERS: Record<ExtraPageType, (input: any) => string> = {
  about: buildAboutPrompt,
  services: buildServicesPrompt,
  gallery: buildGalleryPrompt,
};

const WORKER_ROOT = join(__dirname, "..", "workers", "extra-pages");

async function main() {
  const businessId = process.argv[2];
  if (!businessId) {
    console.error("Usage: npx tsx scripts/run-extra-pages.ts <businessId>");
    process.exit(1);
  }

  const baseUrl = process.env.PREVIEW_BASE_URL ?? "https://draft.siteforge.agency";

  // Fetch business
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { market: true },
  });
  console.log(`Business: ${business.name} (${business.city}, ${business.state})`);

  // Find deployed landing page
  const intentPage = await prisma.intentPage.findFirst({
    where: { businessId, pageType: "landing" },
  });

  if (!intentPage?.htmlUrl) {
    console.error("No deployed landing page found for this business");
    process.exit(1);
  }

  const slug = intentPage.slug;
  console.log(`Slug: ${slug}`);
  console.log(`Landing page URL: ${intentPage.deployedUrl}`);

  // Fetch landing page HTML from storage (not live URL, to avoid claim bar duplication)
  console.log("Fetching landing page HTML from storage...");
  const htmlRes = await fetch(intentPage.htmlUrl);
  if (!htmlRes.ok) {
    console.error(`Failed to fetch HTML: ${htmlRes.status}`);
    process.exit(1);
  }
  const landingHtml = await htmlRes.text();
  console.log(`Landing page HTML: ${landingHtml.length} bytes`);

  // Extract <head> for grafting
  const landingHead = extractHead(landingHtml);
  console.log("Extracted <head> from landing page");

  const businessContext = buildBusinessContext(business as unknown as BusinessInput);

  // Generate each extra page
  for (const pageType of PAGE_TYPES) {
    console.log(`\n--- Generating ${pageType} page ---`);

    // Check if already exists
    const existing = await prisma.previewPage.findFirst({
      where: { slug, pageType },
    });
    if (existing) {
      console.log(`${pageType} page already exists, skipping`);
      continue;
    }

    const prompt = PROMPT_BUILDERS[pageType]({
      businessContext,
      slug,
      baseUrl,
    });

    console.log(`Calling Claude CLI...`);
    const raw = await runClaude(prompt, { cwd: WORKER_ROOT });
    let html = extractHtml(raw);
    console.log(`${pageType} page generated (${html.length} bytes)`);

    // Graft the landing page's <head>
    html = graftHead(html, landingHead);
    console.log(`Grafted landing page <head> onto ${pageType} page`);

    // Deploy to R2
    console.log(`Deploying to R2...`);
    const { deployedUrl } = await deployToCloudflare(slug, html, [], business.name, pageType);
    console.log(`Deployed: ${deployedUrl}`);

    // Create DB rows
    await prisma.previewPage.create({
      data: {
        businessId,
        slug,
        pageType,
        templateId: "ai-generated",
        aiContent: { generator: "claude-sonnet-4-6", pageType, generatedAt: new Date().toISOString() },
        htmlUrl: deployedUrl,
        previewUrl: `${baseUrl}/${slug}/${pageType}`,
      },
    });

    await prisma.intentPage.create({
      data: {
        businessId,
        slug,
        pageType,
        templateId: "ai-generated",
        aiContent: { generator: "claude-sonnet-4-6", pageType, generatedAt: new Date().toISOString() },
        htmlUrl: deployedUrl,
        deployedUrl,
      },
    });

    console.log(`${pageType} page saved to DB`);
  }

  // Inject nav into landing page and redeploy
  console.log("\n--- Redeploying landing page with nav ---");
  const updatedHtml = injectPageNav(landingHtml, slug, baseUrl);
  const { deployedUrl: landingUrl } = await deployToCloudflare(slug, updatedHtml, [], business.name);
  console.log(`Landing page redeployed: ${landingUrl}`);

  console.log("\n=== Done ===");
  console.log(`Home:     ${baseUrl}/${slug}/`);
  console.log(`About:    ${baseUrl}/${slug}/about/`);
  console.log(`Services: ${baseUrl}/${slug}/services/`);
  console.log(`Gallery:  ${baseUrl}/${slug}/gallery/`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

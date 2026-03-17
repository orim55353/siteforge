import type { Job } from "bullmq";
import type { ExtraPagesJobData, ExtraPagesJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { runClaude, extractHtml, buildBusinessContext } from "@lead-gen/ai";
import type { BusinessInput } from "@lead-gen/ai";
import { injectPageNav } from "@lead-gen/templates";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractHead, graftHead } from "./extract-config.js";
import { buildAboutPrompt, buildServicesPrompt, buildGalleryPrompt } from "./prompts.js";
import { uploadToSupabase } from "./storage.js";
import { deployToCloudflare } from "./deploy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = join(__dirname, "..");

const PAGE_TYPES = ["about", "services", "gallery"] as const;
type ExtraPageType = (typeof PAGE_TYPES)[number];

const PROMPT_BUILDERS: Record<
  ExtraPageType,
  (input: { businessContext: string; slug: string; baseUrl: string }) => string
> = {
  about: buildAboutPrompt,
  services: buildServicesPrompt,
  gallery: buildGalleryPrompt,
};

const MAX_RETRIES = 2;

export async function processExtraPagesJob(
  job: Job<ExtraPagesJobData, ExtraPagesJobResult>,
): Promise<ExtraPagesJobResult> {
  const { businessId, slug } = job.data;
  const baseUrl = requireEnv("PREVIEW_BASE_URL");

  // ── Idempotency check — skip if extra pages already exist ──
  const existingPages = await prisma.previewPage.findMany({
    where: {
      slug,
      pageType: { in: ["about", "services", "gallery"] },
    },
    select: { id: true, pageType: true },
  });

  if (existingPages.length >= PAGE_TYPES.length) {
    await job.log(`Extra pages already exist for slug="${slug}", skipping`);
    return {
      previewPageIds: existingPages.map((p) => p.id),
      deployedUrls: PAGE_TYPES.map((pt) => `${baseUrl}/${slug}/${pt}`),
    };
  }

  // Determine which page types still need generating
  const existingTypes = new Set(existingPages.map((p) => p.pageType));
  const remainingTypes = PAGE_TYPES.filter((pt) => !existingTypes.has(pt));

  // ── Fetch business data ──
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { market: true },
  });

  await job.log(`Generating extra pages for: ${business.name} (slug: ${slug})`);

  // ── Fetch existing landing page HTML ──
  await job.log("Fetching landing page to extract config...");

  const existingLandingPage = await prisma.intentPage.findFirst({
    where: { slug, pageType: "landing" },
  });

  if (!existingLandingPage?.htmlUrl) {
    throw new Error(`No deployed landing page found for slug "${slug}"`);
  }

  const htmlRes = await fetch(existingLandingPage.htmlUrl);
  if (!htmlRes.ok) {
    throw new Error(`Failed to fetch landing page HTML: ${htmlRes.status}`);
  }
  const landingHtml = await htmlRes.text();

  // ── Extract <head> from landing page ──
  const landingHead = extractHead(landingHtml);
  await job.log("Extracted <head> from landing page for grafting");

  const businessContext = buildBusinessContext(business as unknown as BusinessInput);

  const previewPageIds = existingPages.map((p) => p.id);
  const deployedUrls: string[] = [];

  // ── Generate each remaining extra page ──
  for (const pageType of remainingTypes) {
    await job.log(`Generating ${pageType} page...`);

    const prompt = PROMPT_BUILDERS[pageType]({
      businessContext,
      slug,
      baseUrl,
    });

    let html: string | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const raw = await runClaude(prompt, { cwd: WORKER_ROOT });
      try {
        html = extractHtml(raw);
        await job.log(`${pageType} page generated (${html.length} bytes)`);
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
        await job.log(`${pageType} attempt ${attempt} failed, retrying...`);
      }
    }

    if (!html) throw new Error(`Failed to generate ${pageType} page`);

    // Graft the landing page's <head> onto the generated page
    html = graftHead(html, landingHead);
    await job.log(`Grafted landing page <head> onto ${pageType} page`);

    // Upload to Supabase Storage
    const htmlUrl = await uploadToSupabase(`${slug}-${pageType}`, html);
    await job.log(`Uploaded ${pageType} to Supabase Storage: ${htmlUrl}`);

    // Create PreviewPage row
    const previewPage = await prisma.previewPage.create({
      data: {
        businessId,
        slug,
        pageType,
        templateId: "ai-generated",
        aiContent: { generator: "claude-sonnet-4-6", pageType, generatedAt: new Date().toISOString() },
        htmlUrl,
        previewUrl: `${baseUrl}/${slug}/${pageType}`,
      },
    });
    previewPageIds.push(previewPage.id);

    // Deploy to R2
    const { deployedUrl } = await deployToCloudflare(slug, html, [], business.name, pageType);
    deployedUrls.push(deployedUrl);
    await job.log(`Deployed ${pageType} to: ${deployedUrl}`);

    // Create IntentPage row
    await prisma.intentPage.create({
      data: {
        businessId,
        slug,
        pageType,
        templateId: "ai-generated",
        aiContent: { generator: "claude-sonnet-4-6", pageType, generatedAt: new Date().toISOString() },
        htmlUrl,
        deployedUrl,
      },
    });
  }

  // ── Inject nav into existing landing page and redeploy ──
  await job.log("Injecting navigation into landing page...");
  const updatedLandingHtml = injectPageNav(landingHtml, slug, baseUrl);

  const { deployedUrl: landingDeployedUrl } = await deployToCloudflare(
    slug,
    updatedLandingHtml,
    [],
    business.name,
  );
  deployedUrls.push(landingDeployedUrl);
  await job.log(`Redeployed landing page with nav: ${landingDeployedUrl}`);

  await job.log(`Extra pages complete: ${previewPageIds.length} pages total`);

  return { previewPageIds, deployedUrls };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

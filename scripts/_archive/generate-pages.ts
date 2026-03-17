/**
 * Standalone page generation script using Claude Code CLI.
 *
 * Fetches all "qualified" businesses, generates AI content via `claude -p`,
 * renders Handlebars templates, and uploads to Supabase Storage.
 *
 * Usage: npx tsx scripts/generate-pages.ts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
config({ path: join(__dirname, "..", ".env") });

// ─── Config ────────────────────────────────────────────────────
const TEMPLATE_ID = "default";
const CLI_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const BUCKET = "preview-pages";
const PAGE_GEN_ROOT = join(__dirname, "..", "workers", "page-gen");

// ─── Clients ───────────────────────────────────────────────────
const prisma = new PrismaClient();

function log(msg: string) {
  console.log(`[generate-pages] ${msg}`);
}

// ─── Claude CLI Runner ─────────────────────────────────────────

function runClaude<T>(prompt: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p", "--dangerously-skip-permissions", "--output-format", "text", "--model", "claude-opus-4-6"],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, cwd: PAGE_GEN_ROOT },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[runClaude] CLI error:", error.message);
          if (stderr) console.error("[runClaude] stderr:", stderr);
          return reject(new Error(`Claude CLI failed: ${error.message}`));
        }

        try {
          const cleaned = stripAnsi(stdout).trim();
          const json = extractJson(cleaned);
          resolve(JSON.parse(json) as T);
        } catch (parseError) {
          console.error("[runClaude] Parse error. Raw output:", stdout.slice(0, 500));
          reject(new Error(`Failed to parse Claude CLI output: ${parseError}`));
        }
      },
    );

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function extractJson(str: string): string {
  const fenceMatch = str.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const startIdx = str.search(/[{[]/);
  if (startIdx === -1) throw new Error("No JSON found in output");

  const openChar = str[startIdx];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;

  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === openChar) depth++;
    if (str[i] === closeChar) depth--;
    if (depth === 0) return str.slice(startIdx, i + 1);
  }

  throw new Error("Unbalanced JSON in output");
}

// ─── AI Content Generation ─────────────────────────────────────

interface HeadlineContent {
  title: string;
  subtitle: string;
  ctaText: string;
}

interface ServicesContent {
  intro: string;
  items: Array<{ name: string; description: string }>;
}

interface FaqContent {
  items: Array<{ question: string; answer: string }>;
}

interface SeoMetaContent {
  title: string;
  description: string;
  keywords: string[];
}

interface AiContent {
  headline: HeadlineContent;
  services: ServicesContent;
  faq: FaqContent;
  seoMeta: SeoMetaContent;
}

function buildBusinessContext(business: {
  name: string;
  city?: string | null;
  state?: string | null;
  categories?: string[];
  googleRating?: unknown;
  reviewCount?: number | null;
  website?: string | null;
}): string {
  const parts = [
    `Business name: ${business.name}`,
    business.city && business.state && `Location: ${business.city}, ${business.state}`,
    business.categories?.length && `Categories: ${business.categories.join(", ")}`,
    business.googleRating && `Google rating: ${business.googleRating}/5 (${business.reviewCount ?? 0} reviews)`,
    business.website && `Website: ${business.website}`,
  ];
  return parts.filter(Boolean).join("\n");
}

function buildPrompt(businessContext: string, instruction: string): string {
  return `You are a marketing copywriter for local businesses. You return ONLY valid JSON — no markdown, no explanation, no wrapping.

${instruction}

Business info:
${businessContext}`;
}

async function generateAllSections(businessContext: string): Promise<AiContent> {
  log("  Generating headline...");
  const headline = await runClaude<HeadlineContent>(
    buildPrompt(
      businessContext,
      `Generate a compelling headline section for this local business landing page.
Return JSON with exactly these fields:
- "title": a short, attention-grabbing headline (max 10 words)
- "subtitle": a supporting line that builds trust (max 20 words)
- "ctaText": call-to-action button text (max 5 words, e.g. "Call Us Today")`,
    ),
  );

  log("  Generating services...");
  const services = await runClaude<ServicesContent>(
    buildPrompt(
      businessContext,
      `Generate a services section for this local business landing page.
Return JSON with exactly these fields:
- "intro": a 1-2 sentence intro to the services offered
- "items": an array of 4-6 service objects, each with "name" (string) and "description" (1-2 sentences)

Base services on the business category. Be specific and relevant.`,
    ),
  );

  log("  Generating FAQ...");
  const faq = await runClaude<FaqContent>(
    buildPrompt(
      businessContext,
      `Generate an FAQ section for this local business landing page.
Return JSON with exactly this field:
- "items": an array of 4-5 FAQ objects, each with "question" (string) and "answer" (1-2 sentences)

Questions should be what real customers would ask about this type of business.`,
    ),
  );

  log("  Generating SEO meta...");
  const seoMeta = await runClaude<SeoMetaContent>(
    buildPrompt(
      businessContext,
      `Generate SEO metadata for this local business landing page.
Return JSON with exactly these fields:
- "title": SEO title tag (50-60 chars, include business name and location)
- "description": meta description (120-155 chars, include a call to action)
- "keywords": array of 5-8 relevant SEO keywords`,
    ),
  );

  return { headline, services, faq, seoMeta };
}

// ─── Slug Generator ────────────────────────────────────────────

function generateSlug(name: string, city: string | null, id: string): string {
  const base = [name, city].filter(Boolean).join("-");
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${clean}-${id.slice(0, 8)}`;
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log("\n========================================");
  console.log("  Page Generation — Claude CLI Mode");
  console.log("========================================\n");

  // Load Handlebars template
  const templatePath = join(__dirname, "..", "packages", "templates", "pages", `${TEMPLATE_ID}.hbs`);
  const templateSource = await readFile(templatePath, "utf-8");
  const template = Handlebars.compile(templateSource);

  // Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Ensure bucket exists
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (bucketError && !bucketError.message.includes("already exists")) {
    log(`Warning: bucket creation: ${bucketError.message}`);
  }

  // Fetch all qualified businesses
  const businesses = await prisma.business.findMany({
    where: { status: "qualified" },
    include: { market: true },
  });

  if (businesses.length === 0) {
    log("No qualified businesses found. Nothing to do.");
    return;
  }

  log(`Found ${businesses.length} qualified business(es)\n`);

  const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? "https://draft.example.com";
  let successCount = 0;
  let failCount = 0;

  for (const business of businesses) {
    log(`Processing: ${business.name} (${business.id})`);

    try {
      // Generate AI content sequentially
      const businessContext = buildBusinessContext(business);
      const aiContent = await generateAllSections(businessContext);
      log("  AI content generated");

      // Render HTML
      const context = {
        business: {
          name: business.name,
          phone: business.phone,
          email: business.email,
          website: business.website,
          address: business.address,
          city: business.city,
          state: business.state,
          googleRating: business.googleRating,
          reviewCount: business.reviewCount,
          categories: business.categories,
        },
        headline: aiContent.headline,
        services: aiContent.services,
        faq: aiContent.faq,
        seoMeta: aiContent.seoMeta,
      };

      const html = template(context);
      log(`  Rendered HTML (${html.length} bytes)`);

      // Upload to Supabase Storage
      const slug = generateSlug(business.name, business.city, business.id);
      const filePath = `${slug}.html`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, html, { contentType: "text/html", upsert: true });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
      const htmlUrl = urlData.publicUrl;
      const previewUrl = `${previewBaseUrl}/${slug}`;

      log(`  Uploaded: ${htmlUrl}`);

      // Create/update preview page
      await prisma.previewPage.upsert({
        where: { slug },
        update: {
          aiContent: JSON.parse(JSON.stringify(aiContent)),
          htmlUrl,
          previewUrl,
        },
        create: {
          businessId: business.id,
          slug,
          templateId: TEMPLATE_ID,
          aiContent: JSON.parse(JSON.stringify(aiContent)),
          htmlUrl,
          previewUrl,
        },
      });

      // Update business status
      await prisma.business.update({
        where: { id: business.id },
        data: { status: "page_generated" },
      });

      log(`  Done — slug: ${slug}\n`);
      successCount++;
    } catch (err) {
      failCount++;
      console.error(`  FAILED: ${err}\n`);
      // Continue to next business
    }
  }

  console.log("========================================");
  console.log(`  Complete: ${successCount} success, ${failCount} failed`);
  console.log("========================================\n");
}

main()
  .catch((err) => {
    console.error("[FATAL]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

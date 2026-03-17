/**
 * Generate and deploy a landing page for a specific business.
 *
 * Usage:
 *   npx tsx scripts/run-page-gen.ts <businessId>
 *   npx tsx scripts/run-page-gen.ts <businessId> --skip-deploy   # generate only, no upload
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { generatePage } from "../workers/page-gen/src/ai-content.js";
import { uploadToSupabase } from "../workers/page-gen/src/storage.js";

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
const skipDeploy = process.argv.includes("--skip-deploy");

if (!businessId) {
  console.error("Usage: npx tsx scripts/run-page-gen.ts <businessId> [--skip-deploy]");
  process.exit(1);
}

async function main() {
  const business = await prisma.business.findUnique({ where: { id: businessId } });

  if (!business) {
    console.error(`Business not found: ${businessId}`);
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("  PAGE GENERATION");
  console.log(`  Business: ${business.name} (${business.city}, ${business.state})`);
  console.log(`  Status: ${business.status}`);
  console.log(`  Deploy: ${skipDeploy ? "skip" : "yes"}`);
  console.log("========================================\n");

  const startTime = Date.now();

  // ── Generate HTML ──
  log("PAGE-GEN", "Generating landing page via Claude CLI (opus)...");
  const html = await generatePage(business);
  log("PAGE-GEN", `HTML generated (${html.length} bytes)`);

  if (skipDeploy) {
    // Write to local file for preview
    const { writeFile } = await import("node:fs/promises");
    const slug = generateSlug(business.name, business.city, business.id);
    const outPath = join(__dirname, "..", `${slug}.html`);
    await writeFile(outPath, html, "utf-8");
    log("PAGE-GEN", `Saved locally: ${outPath}`);
  } else {
    // ── Upload to Supabase Storage ──
    const slug = generateSlug(business.name, business.city, business.id);
    log("DEPLOY", `Uploading to Supabase Storage (slug: ${slug})...`);
    const htmlUrl = await uploadToSupabase(slug, html);
    log("DEPLOY", `Uploaded: ${htmlUrl}`);

    // ── Create preview page record ──
    const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? "https://draft.example.com";
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

    // ── Update business status ──
    await prisma.business.update({
      where: { id: business.id },
      data: { status: "page_generated" },
    });

    log("DEPLOY", `Preview page: ${previewPage.previewUrl}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

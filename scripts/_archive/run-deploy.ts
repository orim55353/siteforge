/**
 * Deploy-only script: takes an already-generated page from Supabase Storage
 * and deploys it to Cloudflare R2.
 *
 * Usage:
 *   npx tsx scripts/run-deploy.ts <businessId>
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { deployToCloudflare, inferContentType } from "../workers/deploy/src/cloudflare.js";
import type { SiteAsset } from "../workers/deploy/src/cloudflare.js";

const prisma = new PrismaClient();

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${step}] ${msg}`);
}

const businessId = process.argv[2];
if (!businessId) {
  console.error("Usage: npx tsx scripts/run-deploy.ts <businessId>");
  process.exit(1);
}

async function fetchBusinessImages(slug: string): Promise<SiteAsset[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  const listRes = await fetch(`${supabaseUrl}/storage/v1/object/list/site-images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: `${slug}/`, limit: 100 }),
  });

  if (!listRes.ok) {
    log("IMAGES", `No images found for ${slug} (${listRes.status})`);
    return [];
  }

  const files = (await listRes.json()) as Array<{ name: string }>;
  const imageFiles = files.filter((f) => /\.(jpg|jpeg|png|webp|avif|svg|gif)$/i.test(f.name));

  if (imageFiles.length === 0) return [];

  log("IMAGES", `Found ${imageFiles.length} images`);

  const assets: SiteAsset[] = [];
  const results = await Promise.allSettled(
    imageFiles.map(async (file) => {
      const res = await fetch(
        `${supabaseUrl}/storage/v1/object/site-images/${slug}/${file.name}`,
        { headers: { Authorization: `Bearer ${supabaseKey}` } },
      );
      if (!res.ok) throw new Error(`Failed to fetch ${file.name}: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { filename: file.name, body: buffer, contentType: inferContentType(file.name) };
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") assets.push(r.value);
    else log("IMAGES", `Warning: ${r.reason}`);
  }

  return assets;
}

async function main() {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) {
    console.error(`Business not found: ${businessId}`);
    process.exit(1);
  }

  // Find the latest preview page
  const previewPage = await prisma.previewPage.findFirst({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });

  if (!previewPage?.htmlUrl) {
    console.error(`No preview page with htmlUrl found for ${business.name}. Run page-gen first.`);
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("  DEPLOY TO R2");
  console.log(`  Business: ${business.name} (${business.city}, ${business.state})`);
  console.log(`  Slug: ${previewPage.slug}`);
  console.log("========================================\n");

  const startTime = Date.now();

  // Fetch HTML from Supabase Storage
  log("FETCH", `Downloading HTML from ${previewPage.htmlUrl}`);
  const htmlRes = await fetch(previewPage.htmlUrl);
  if (!htmlRes.ok) {
    console.error(`Failed to fetch HTML (${htmlRes.status})`);
    process.exit(1);
  }
  const html = await htmlRes.text();
  log("FETCH", `HTML downloaded (${html.length} bytes)`);

  // Fetch images
  const assets = await fetchBusinessImages(previewPage.slug);

  // Deploy to R2
  log("DEPLOY", `Uploading to R2 (slug: ${previewPage.slug})...`);
  const { deployedUrl, r2Keys } = await deployToCloudflare(previewPage.slug, html, assets, business.name);
  log("DEPLOY", `Uploaded ${r2Keys.length} files to R2`);

  // Upsert intent page
  await prisma.intentPage.upsert({
    where: { slug: previewPage.slug },
    update: {
      aiContent: previewPage.aiContent as object,
      htmlUrl: previewPage.htmlUrl,
      deployedUrl,
    },
    create: {
      businessId,
      slug: previewPage.slug,
      templateId: previewPage.templateId,
      aiContent: previewPage.aiContent as object,
      htmlUrl: previewPage.htmlUrl,
      deployedUrl,
    },
  });

  // Update status
  await prisma.business.update({
    where: { id: businessId },
    data: { status: "page_deployed" },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nLive: ${deployedUrl}`);
  console.log(`Done in ${elapsed}s`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

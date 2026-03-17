/**
 * One-time migration: copy all deployed pages from Supabase Storage to R2.
 *
 * For each IntentPage:
 * 1. Fetch HTML from Supabase Storage (htmlUrl)
 * 2. Upload to R2 as {slug}/index.html
 * 3. Update deployedUrl in database to new PREVIEW_BASE_URL
 *
 * Also migrates PreviewPages that exist in Supabase Storage.
 *
 * Usage: npx tsx scripts/migrate-to-r2.ts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const prisma = new PrismaClient();

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function createR2Client(): S3Client {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 env vars: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const CONCURRENCY = 5;

async function migratePages() {
  const bucketName = process.env.R2_BUCKET_NAME ?? "landing-pages";
  const baseUrl = process.env.PREVIEW_BASE_URL;
  if (!baseUrl) throw new Error("Missing PREVIEW_BASE_URL env var");

  const client = createR2Client();

  // Gather all pages to migrate (intent pages = deployed, preview pages = drafts)
  const intentPages = await prisma.intentPage.findMany({
    select: { id: true, slug: true, htmlUrl: true, deployedUrl: true },
  });

  const previewPages = await prisma.previewPage.findMany({
    select: { id: true, slug: true, htmlUrl: true },
  });

  // Deduplicate by slug — intent pages take priority
  const slugsSeen = new Set<string>();
  const pagesToMigrate: Array<{
    slug: string;
    htmlUrl: string | null;
    type: string;
    id: string;
  }> = [];

  for (const p of intentPages) {
    slugsSeen.add(p.slug);
    pagesToMigrate.push({
      slug: p.slug,
      htmlUrl: p.htmlUrl,
      type: "intent",
      id: p.id,
    });
  }
  for (const p of previewPages) {
    if (!slugsSeen.has(p.slug)) {
      pagesToMigrate.push({
        slug: p.slug,
        htmlUrl: p.htmlUrl,
        type: "preview",
        id: p.id,
      });
    }
  }

  const uniquePreviewCount = pagesToMigrate.length - intentPages.length;
  const deduplicatedCount = previewPages.length - uniquePreviewCount;
  log(
    `Found ${pagesToMigrate.length} pages to migrate (${intentPages.length} intent, ${uniquePreviewCount} preview, ${deduplicatedCount} deduplicated)`,
  );

  let success = 0;
  let failed = 0;

  // Process in batches for concurrency control
  for (let i = 0; i < pagesToMigrate.length; i += CONCURRENCY) {
    const batch = pagesToMigrate.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (page) => {
        if (!page.htmlUrl) {
          log(`  SKIP ${page.slug} — no htmlUrl`);
          return;
        }

        // Fetch HTML from Supabase Storage
        const res = await fetch(page.htmlUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch ${page.htmlUrl}: ${res.status}`);
        }
        const html = await res.text();

        // Upload to R2
        const r2Key = `${page.slug}/index.html`;
        await client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: r2Key,
            Body: html,
            ContentType: "text/html; charset=utf-8",
            CacheControl: "public, max-age=3600, s-maxage=86400",
          }),
        );

        // Update deployedUrl for intent pages
        if (page.type === "intent") {
          const newUrl = `${baseUrl}/${page.slug}`;
          await prisma.intentPage.update({
            where: { id: page.id },
            data: { deployedUrl: newUrl },
          });
        }

        log(`  OK ${page.slug} (${html.length} bytes)`);
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        success++;
      } else {
        failed++;
        log(`  FAIL: ${r.reason}`);
      }
    }
  }

  log(`\nMigration complete: ${success} succeeded, ${failed} failed`);
}

async function main() {
  console.log("\n========================================");
  console.log("  MIGRATE PAGES TO CLOUDFLARE R2");
  console.log("========================================\n");

  await migratePages();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

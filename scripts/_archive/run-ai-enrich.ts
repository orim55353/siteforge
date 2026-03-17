/**
 * AI-only enrichment script: runs Claude AI analysis on businesses
 * that don't have aiInsights yet.
 *
 * Usage:
 *   npx tsx scripts/run-ai-enrich.ts                  # all discovered/enriched without aiInsights
 *   npx tsx scripts/run-ai-enrich.ts 5                # limit to 5 businesses
 *   npx tsx scripts/run-ai-enrich.ts --id <businessId> # single business by ID
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { Prisma, PrismaClient } from "@prisma/client";
import { aiEnrichWebsite } from "../workers/enrichment/src/ai-enrichment.js";

const prisma = new PrismaClient();

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${step}] ${msg}`);
}

// ─── Parse CLI args ──────────────────────────────────────────
const args = process.argv.slice(2);
const idFlagIndex = args.indexOf("--id");
const singleId = idFlagIndex !== -1 ? args[idFlagIndex + 1] : null;
const limit = singleId
  ? undefined
  : (parseInt(args[0] ?? "0", 10) || undefined);

async function aiEnrichBusiness(businessId: string) {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  log("AI", `${business.name} (${business.city}, ${business.state})`);

  // Use existing website HTML from prior audit if available
  let websiteHtml: string | null = null;
  if (business.website) {
    try {
      const { auditWebsite } = await import(
        "../workers/enrichment/src/website-audit.js"
      );
      const audit = await auditWebsite(business.website);
      websiteHtml = audit.loads ? audit.html : null;
    } catch {
      log("AI", "  Could not fetch website HTML (non-fatal)");
    }
  }

  const aiInsights = await aiEnrichWebsite({
    businessName: business.name,
    category: business.categories?.[0] ?? null,
    city: business.city,
    state: business.state,
    googleRating: business.googleRating,
    reviewCount: business.reviewCount,
    categories: business.categories ?? [],
    html: websiteHtml,
  });

  log(
    "AI",
    `  ${aiInsights.designQuality} design, ${aiInsights.services.length} services, ${aiInsights.painPoints.length} pain points`,
  );

  await prisma.business.update({
    where: { id: businessId },
    data: {
      aiInsights: JSON.parse(JSON.stringify(aiInsights)),
    },
  });

  log("AI", "  Saved aiInsights");
}

async function main() {
  let businesses: Array<{ id: string; name: string; city: string | null; state: string | null }>;

  if (singleId) {
    const b = await prisma.business.findUniqueOrThrow({
      where: { id: singleId },
      select: { id: true, name: true, city: true, state: true },
    });
    businesses = [b];
    log("AI", `Forcing AI enrichment on ${b.name} (--id mode, skipping status/aiInsights checks)`);
  } else {
    businesses = await prisma.business.findMany({
      where: {
        status: { in: ["discovered", "enriched"] },
        aiInsights: { equals: Prisma.DbNull },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, city: true, state: true },
      take: limit,
    });
  }

  if (businesses.length === 0) {
    console.log("No businesses need AI enrichment.");
    await prisma.$disconnect();
    return;
  }

  console.log("\n========================================");
  console.log("  AI ENRICHMENT ONLY");
  console.log(`  ${businesses.length} business${businesses.length === 1 ? "" : "es"} to process`);
  console.log("========================================\n");

  const startTime = Date.now();
  let succeeded = 0;
  let failed = 0;

  for (const b of businesses) {
    try {
      await aiEnrichBusiness(b.id);
      succeeded++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log("AI", `  FAILED: ${b.name} — ${message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n========================================");
  console.log("  DONE!");
  console.log(`  AI Enriched: ${succeeded} | Failed: ${failed} | Elapsed: ${elapsed}s`);
  console.log("========================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

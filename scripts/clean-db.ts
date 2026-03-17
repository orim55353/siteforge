/**
 * Clean the entire database — removes all data in correct FK order.
 *
 * Usage: npx tsx scripts/clean-db.ts
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanDb() {
  console.log("Cleaning database...\n");

  // Delete in order respecting foreign keys (children first)
  const replies = await prisma.reply.deleteMany({});
  console.log(`  Deleted ${replies.count} replies`);

  const emailEvents = await prisma.emailEvent.deleteMany({});
  console.log(`  Deleted ${emailEvents.count} email events`);

  const outreachMessages = await prisma.outreachMessage.deleteMany({});
  console.log(`  Deleted ${outreachMessages.count} outreach messages`);

  const intentPages = await prisma.intentPage.deleteMany({});
  console.log(`  Deleted ${intentPages.count} intent pages`);

  const previewPages = await prisma.previewPage.deleteMany({});
  console.log(`  Deleted ${previewPages.count} preview pages`);

  const businesses = await prisma.business.deleteMany({});
  console.log(`  Deleted ${businesses.count} businesses`);

  const markets = await prisma.market.deleteMany({});
  console.log(`  Deleted ${markets.count} markets`);

  const discoveryCache = await prisma.discoveryCache.deleteMany({});
  console.log(`  Deleted ${discoveryCache.count} discovery cache entries`);

  const marketScans = await prisma.marketScan.deleteMany({});
  console.log(`  Deleted ${marketScans.count} market scans`);

  console.log("\nDatabase cleaned.");
  await prisma.$disconnect();
}

cleanDb().catch((err) => {
  console.error("Failed to clean DB:", err);
  process.exit(1);
});

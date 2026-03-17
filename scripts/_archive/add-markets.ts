/**
 * Add markets to the database.
 *
 * Usage:
 *   npx tsx scripts/add-markets.ts "barber shop" "Miami" "FL"
 *   npx tsx scripts/add-markets.ts "taqueria" "Houston" "TX" "dentist" "Austin" "TX"
 *   npx tsx scripts/add-markets.ts --file markets.txt
 *
 * File format (one market per line):
 *   barber shop, Miami, FL
 *   taqueria, Houston, TX
 *   dentist, Austin, TX
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface MarketInput {
  industry: string;
  city: string;
  state: string;
}

function parseArgs(): MarketInput[] {
  const args = process.argv.slice(2);
  const markets: MarketInput[] = [];

  if (args.length === 0) {
    console.error("Usage:");
    console.error('  npx tsx scripts/add-markets.ts "barber shop" "Miami" "FL"');
    console.error('  npx tsx scripts/add-markets.ts "taqueria" "Houston" "TX" "dentist" "Austin" "TX"');
    console.error("  npx tsx scripts/add-markets.ts --file markets.txt");
    process.exit(1);
  }

  // File mode
  if (args[0] === "--file") {
    return []; // handled separately in main()
  }

  // CLI args: groups of 3 (industry, city, state)
  if (args.length % 3 !== 0) {
    console.error("Error: arguments must be in groups of 3: <industry> <city> <state>");
    process.exit(1);
  }

  for (let i = 0; i < args.length; i += 3) {
    markets.push({
      industry: args[i].toLowerCase().trim(),
      city: args[i + 1].trim(),
      state: args[i + 2].toUpperCase().trim(),
    });
  }

  return markets;
}

async function parseFile(filePath: string): Promise<MarketInput[]> {
  const resolved = join(__dirname, "..", filePath);
  const content = await readFile(resolved, "utf-8");
  const markets: MarketInput[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length !== 3) {
      console.error(`Skipping invalid line: "${trimmed}" (expected: industry, city, state)`);
      continue;
    }

    markets.push({
      industry: parts[0].toLowerCase(),
      city: parts[1],
      state: parts[2].toUpperCase(),
    });
  }

  return markets;
}

async function main() {
  const args = process.argv.slice(2);
  const markets = args[0] === "--file"
    ? await parseFile(args[1] ?? "markets.txt")
    : parseArgs();

  if (markets.length === 0) {
    console.error("No markets to add.");
    process.exit(1);
  }

  console.log(`\nAdding ${markets.length} market(s)...\n`);

  let created = 0;
  let skipped = 0;

  for (const m of markets) {
    const existing = await prisma.market.findFirst({
      where: { industry: m.industry, city: m.city, state: m.state },
    });

    if (existing) {
      console.log(`  SKIP  ${m.industry} in ${m.city}, ${m.state} (already exists)`);
      skipped++;
      continue;
    }

    const name = `${m.industry.charAt(0).toUpperCase() + m.industry.slice(1)}s in ${m.city}, ${m.state}`;
    const market = await prisma.market.create({
      data: { name, industry: m.industry, city: m.city, state: m.state },
    });

    console.log(`  ADD   ${name} (${market.id})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

/**
 * Sync markets from data.md into the database.
 *
 * Parses the markdown tables, upserts each market (industry + city + state),
 * and preserves opportunity metadata. Markets removed from data.md are
 * deactivated (not deleted) so historical scan data is kept.
 *
 * Usage:
 *   npx tsx scripts/sync-markets.ts                  # sync from data.md
 *   npx tsx scripts/sync-markets.ts path/to/file.md  # custom file
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Types ──────────────────────────────────────────────────

interface ParsedMarket {
  industry: string;
  city: string;
  state: string;
  opportunityScore: number;
  marketSize: string;
  digitalGap: string;
  notes: string;
}

interface ParsedCity {
  city: string;
  state: string;
  cityScore: number;
  markets: ParsedMarket[];
}

// ─── State abbreviation lookup ──────────────────────────────

const STATE_ABBREV: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
};

function stateToAbbrev(stateName: string): string {
  return STATE_ABBREV[stateName.trim()] ?? stateName.trim();
}

// ─── Parser ─────────────────────────────────────────────────

function parseDataMd(content: string): ParsedCity[] {
  const cities: ParsedCity[] = [];

  // Match city headers: ### N. City, State, USA (Score: XX)
  const cityPattern = /###\s*\d+\.\s*(.+?),\s*(.+?),\s*USA\s*\(Score:\s*(\d+)\)/g;
  const cityMatches = [...content.matchAll(cityPattern)];

  for (let i = 0; i < cityMatches.length; i++) {
    const match = cityMatches[i];
    const city = match[1].trim();
    const state = stateToAbbrev(match[2]);
    const cityScore = parseInt(match[3], 10);

    // Extract the section between this city header and the next (or end)
    const sectionStart = match.index! + match[0].length;
    const sectionEnd = i + 1 < cityMatches.length ? cityMatches[i + 1].index! : content.length;
    const section = content.slice(sectionStart, sectionEnd);

    // Parse markdown table rows (skip header + separator rows)
    const rows: ParsedMarket[] = [];
    const lines = section.split("\n");

    let inTable = false;
    let headerSkipped = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect table rows (start with |)
      if (!trimmed.startsWith("|")) {
        inTable = false;
        headerSkipped = false;
        continue;
      }

      if (!inTable) {
        inTable = true;
        headerSkipped = false;
        continue; // skip header row
      }

      if (!headerSkipped) {
        // Skip separator row (| --- | --- | ...)
        if (trimmed.includes("---")) {
          headerSkipped = true;
          continue;
        }
      }

      // Parse data row: | Industry | Score | Size | Gap | Notes |
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length >= 5) {
        const industry = cells[0].toLowerCase().trim();
        const score = parseInt(cells[1], 10);
        const marketSize = cells[2].trim();
        const digitalGap = cells[3].trim();
        const notes = cells[4].trim();

        if (!isNaN(score)) {
          rows.push({
            industry,
            city,
            state,
            opportunityScore: score,
            marketSize,
            digitalGap,
            notes,
          });
        }
      }
    }

    cities.push({ city, state, cityScore, markets: rows });
  }

  return cities;
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2] ?? "data.md";
  const resolved = join(__dirname, "..", filePath);

  console.log(`\nReading: ${resolved}`);
  const content = await readFile(resolved, "utf-8");
  const cities = parseDataMd(content);

  const allMarkets = cities.flatMap((c) => c.markets);
  console.log(`Parsed ${cities.length} cities, ${allMarkets.length} market entries\n`);

  if (allMarkets.length === 0) {
    console.error("No markets found in file. Check the format.");
    process.exit(1);
  }

  // Build a set of keys from data.md for deactivation tracking
  const dataFileKeys = new Set(
    allMarkets.map((m) => `${m.industry}|${m.city}|${m.state}`),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const city of cities) {
    console.log(`  ${city.city}, ${city.state} (city score: ${city.cityScore}) — ${city.markets.length} industries`);

    for (const m of city.markets) {
      const name = `${m.industry.charAt(0).toUpperCase() + m.industry.slice(1)} in ${m.city}, ${m.state}`;

      const existing = await prisma.market.findUnique({
        where: { industry_city_state: { industry: m.industry, city: m.city, state: m.state } },
      });

      if (existing) {
        // Check if anything changed
        const changed =
          existing.opportunityScore !== m.opportunityScore ||
          existing.marketSize !== m.marketSize ||
          existing.digitalGap !== m.digitalGap ||
          existing.notes !== m.notes ||
          !existing.active;

        if (changed) {
          await prisma.market.update({
            where: { id: existing.id },
            data: {
              name,
              opportunityScore: m.opportunityScore,
              marketSize: m.marketSize,
              digitalGap: m.digitalGap,
              notes: m.notes,
              sourceFile: filePath,
              active: true,
            },
          });
          updated++;
        } else {
          unchanged++;
        }
      } else {
        await prisma.market.create({
          data: {
            name,
            industry: m.industry,
            city: m.city,
            state: m.state,
            opportunityScore: m.opportunityScore,
            marketSize: m.marketSize,
            digitalGap: m.digitalGap,
            notes: m.notes,
            sourceFile: filePath,
            active: true,
          },
        });
        created++;
      }
    }
  }

  // Deactivate markets that were previously imported from data.md but are no longer in it
  const fileSourcedMarkets = await prisma.market.findMany({
    where: { sourceFile: { not: null }, active: true },
    select: { id: true, industry: true, city: true, state: true },
  });

  let deactivated = 0;
  for (const m of fileSourcedMarkets) {
    const key = `${m.industry}|${m.city}|${m.state}`;
    if (!dataFileKeys.has(key)) {
      await prisma.market.update({
        where: { id: m.id },
        data: { active: false },
      });
      deactivated++;
    }
  }

  // Show scan status
  console.log("\n--- Scan Status ---");
  const activeMarkets = await prisma.market.findMany({
    where: { active: true },
    select: { industry: true, city: true, state: true },
    orderBy: [{ city: "asc" }, { industry: "asc" }],
  });

  const scans = await prisma.marketScan.findMany({
    select: { query: true, qualifying: true, totalResults: true, scannedAt: true },
  });
  const scanMap = new Map(scans.map((s) => [s.query, s]));

  let scanned = 0;
  let unscanned = 0;
  for (const m of activeMarkets) {
    const query = `${m.industry} in ${m.city}, ${m.state}`;
    const scan = scanMap.get(query);
    if (scan) {
      scanned++;
    } else {
      unscanned++;
    }
  }

  console.log(`  Active markets: ${activeMarkets.length}`);
  console.log(`  Already scanned: ${scanned}`);
  console.log(`  Not yet scanned: ${unscanned}`);

  console.log(`\n========================================`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Deactivated: ${deactivated}`);
  console.log(`  Total active: ${activeMarkets.length}`);
  console.log(`========================================\n`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

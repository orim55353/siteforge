/**
 * Delete extra pages (about, services, gallery) for a slug.
 * Usage: npx tsx scripts/clean-extra-pages.ts <slug>
 */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error("Usage: npx tsx scripts/clean-extra-pages.ts <slug>"); process.exit(1); }

  const d1 = await prisma.intentPage.deleteMany({ where: { slug, pageType: { in: ["about", "services", "gallery"] } } });
  const d2 = await prisma.previewPage.deleteMany({ where: { slug, pageType: { in: ["about", "services", "gallery"] } } });
  console.log(`Deleted ${d1.count} intent pages, ${d2.count} preview pages for slug="${slug}"`);
  await prisma.$disconnect();
}

main().catch(console.error);

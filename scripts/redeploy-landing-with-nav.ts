/**
 * Redeploy a landing page with fixed nav injection.
 * Usage: npx tsx scripts/redeploy-landing-with-nav.ts <slug>
 */

import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { injectPageNav } from "../packages/templates/src/nav-injection.js";
import { deployToCloudflare } from "../workers/deploy/src/cloudflare.js";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/redeploy-landing-with-nav.ts <slug>");
    process.exit(1);
  }

  const baseUrl = process.env.PREVIEW_BASE_URL ?? "https://draft.siteforge.agency";

  // Fetch current landing page HTML from live URL
  console.log("Fetching current landing page...");
  const res = await fetch(`${baseUrl}/${slug}/`);
  if (!res.ok) {
    console.error(`Failed to fetch: ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();
  console.log(`Fetched ${html.length} bytes`);

  // Inject nav
  const result = injectPageNav(html, slug, baseUrl);

  // Redeploy
  console.log("Deploying to R2...");
  const { deployedUrl } = await deployToCloudflare(slug, result, []);
  console.log(`Redeployed: ${deployedUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

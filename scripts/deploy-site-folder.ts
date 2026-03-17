/**
 * Deploy a local site folder (HTML + images) to R2.
 *
 * Usage: npx tsx scripts/deploy-site-folder.ts <folder-path> <slug>
 *
 * Example: npx tsx scripts/deploy-site-folder.ts pasta-loco-site pasta-loco
 */

import { config } from "dotenv";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function getCacheControl(contentType: string): string {
  if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
    return "public, max-age=86400, s-maxage=604800";
  }
  return "public, max-age=3600, s-maxage=86400";
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

/**
 * Recursively collect files, skipping unoptimized images when
 * an optimized/ sibling directory exists in the same parent.
 */
async function collectFiles(dir: string, rootDir?: string): Promise<string[]> {
  const root = rootDir ?? dir;
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  // Check if this directory has an "optimized" subdirectory
  const hasOptimizedDir = entries.some(
    (e) => e.isDirectory() && e.name === "optimized",
  );

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, root)));
    } else if (entry.isFile() && !entry.name.startsWith(".")) {
      // Skip raw images if an optimized/ folder exists at this level
      const ext = extname(entry.name).toLowerCase();
      if (hasOptimizedDir && IMAGE_EXTS.has(ext)) {
        continue;
      }
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const folderArg = process.argv[2];
  const slug = process.argv[3];

  if (!folderArg || !slug) {
    console.error("Usage: npx tsx scripts/deploy-site-folder.ts <folder-path> <slug>");
    console.error("Example: npx tsx scripts/deploy-site-folder.ts pasta-loco-site pasta-loco");
    process.exit(1);
  }

  const folderPath = join(__dirname, "..", folderArg);
  const folderStat = await stat(folderPath).catch(() => null);
  if (!folderStat?.isDirectory()) {
    console.error(`Not a directory: ${folderPath}`);
    process.exit(1);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME ?? "landing-pages";
  const baseUrl = process.env.PREVIEW_BASE_URL ?? "";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("Missing R2 env vars: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log("\n========================================");
  console.log(`  DEPLOY TO R2: ${slug}`);
  console.log("========================================\n");

  // Collect all files
  const allFiles = await collectFiles(folderPath);
  log(`Found ${allFiles.length} files in ${folderArg}`);

  let totalBytes = 0;
  let uploaded = 0;

  // Upload in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (filePath) => {
        const relativePath = relative(folderPath, filePath);
        const r2Key = `${slug}/${relativePath}`;
        const body = await readFile(filePath);
        const contentType = getContentType(filePath);

        await client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: r2Key,
            Body: body,
            ContentType: contentType,
            CacheControl: getCacheControl(contentType),
          }),
        );

        totalBytes += body.length;
        uploaded++;
        log(`  ${r2Key} (${(body.length / 1024).toFixed(0)}KB) ${contentType}`);
      }),
    );
  }

  const deployedUrl = baseUrl ? `${baseUrl}/${slug}` : `(set PREVIEW_BASE_URL)/${slug}`;

  console.log("\n========================================");
  console.log("  DONE!");
  console.log("========================================");
  console.log(`  Files:  ${uploaded}`);
  console.log(`  Size:   ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  URL:    ${deployedUrl}`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});

/**
 * Cloudflare R2 upload via S3-compatible API.
 *
 * Uploads a site folder to R2:
 *   {slug}/index.html
 *   {slug}/hero.jpg
 *   {slug}/gallery-1.jpg
 *   ...
 *
 * A Cloudflare Worker serves these at PREVIEW_BASE_URL/{slug}.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { injectClaimBar } from "@lead-gen/templates";

export interface SiteAsset {
  /** Filename relative to the slug folder, e.g. "hero.jpg", "images/gallery-1.jpg" */
  filename: string;
  /** File content as Buffer or string */
  body: Buffer | string;
  /** MIME type, e.g. "image/jpeg" */
  contentType: string;
}

interface DeployResult {
  deployedUrl: string;
  r2Keys: string[];
}

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

/** Infer content type from filename extension. */
export function inferContentType(filename: string): string {
  const ext = filename.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
  return CONTENT_TYPE_MAP[ext] ?? "application/octet-stream";
}

function createR2Client(): S3Client {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * Deploy a site (HTML + assets) to R2.
 *
 * @param slug         — site identifier, becomes the folder name in R2
 * @param html         — the index.html content
 * @param assets       — optional images/files to upload alongside the HTML
 * @param businessName — business name for the claim bar checkout link
 */
export async function deployToCloudflare(
  slug: string,
  html: string,
  assets: SiteAsset[] = [],
  businessName?: string,
): Promise<DeployResult> {
  const bucketName = process.env.R2_BUCKET_NAME ?? "landing-pages";
  const baseUrl = requireEnv("PREVIEW_BASE_URL");
  const client = createR2Client();

  const r2Keys: string[] = [];

  // Replace tracking placeholder with actual API URL
  const trackingUrl = process.env.TRACKING_API_URL ?? `${baseUrl}/t`;
  let finalHtml = html.replace(/%%TRACKING_URL%%/g, trackingUrl);

  // Replace page URL placeholder for OG meta tags
  const pageUrl = `${baseUrl}/${slug}`;
  finalHtml = finalHtml.replace(/%%PAGE_URL%%/g, pageUrl);

  // Inject the "Claim This Website" bar
  const checkoutBaseUrl =
    process.env.AGENCY_CHECKOUT_URL ?? "https://siteforge.agency/checkout";
  finalHtml = injectClaimBar(finalHtml, {
    slug,
    businessName: businessName ?? slug,
    checkoutBaseUrl,
  });

  // Upload index.html
  const htmlKey = `${slug}/index.html`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: htmlKey,
      Body: finalHtml,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "public, max-age=3600, s-maxage=86400",
    }),
  );
  r2Keys.push(htmlKey);

  // Upload assets in parallel (batches of 10 to avoid overwhelming R2)
  const BATCH_SIZE = 10;
  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const batch = assets.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (asset) => {
        const key = `${slug}/${asset.filename}`;
        await client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: asset.body,
            ContentType: asset.contentType,
            CacheControl: "public, max-age=86400, s-maxage=604800",
          }),
        );
        r2Keys.push(key);
      }),
    );
  }

  const deployedUrl = `${baseUrl}/${slug}`;
  return { deployedUrl, r2Keys };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

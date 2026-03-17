/**
 * Re-exports the deploy utility from the deploy worker.
 * Since the deploy worker's cloudflare.ts is a separate package,
 * we duplicate the minimal interface needed here.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { injectClaimBar } from "@lead-gen/templates";
import type { ClaimBarOptions } from "@lead-gen/templates";

export interface SiteAsset {
  filename: string;
  body: Buffer | string;
  contentType: string;
}

interface DeployResult {
  deployedUrl: string;
  r2Keys: string[];
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
 * Deploy HTML to Cloudflare R2.
 *
 * @param slug         - Site identifier
 * @param html         - HTML content
 * @param assets       - Optional additional assets
 * @param businessName - Business name for the claim bar
 * @param subPath      - Optional sub-path (e.g. "about", "services", "gallery")
 */
export async function deployToCloudflare(
  slug: string,
  html: string,
  assets: SiteAsset[] = [],
  businessName?: string,
  subPath?: string,
): Promise<DeployResult> {
  const bucketName = process.env.R2_BUCKET_NAME ?? "landing-pages";
  const baseUrl = requireEnv("PREVIEW_BASE_URL");
  const client = createR2Client();

  const r2Keys: string[] = [];

  // Replace tracking placeholder
  const trackingUrl = process.env.TRACKING_API_URL ?? `${baseUrl}/t`;
  let finalHtml = html.replace(/%%TRACKING_URL%%/g, trackingUrl);

  // Replace page URL placeholder
  const pageUrl = subPath
    ? `${baseUrl}/${slug}/${subPath}`
    : `${baseUrl}/${slug}`;
  finalHtml = finalHtml.replace(/%%PAGE_URL%%/g, pageUrl);

  // Inject claim bar
  const checkoutBaseUrl =
    process.env.AGENCY_CHECKOUT_URL ?? "https://siteforge.agency/checkout";
  finalHtml = injectClaimBar(finalHtml, {
    slug,
    businessName: businessName ?? slug,
    checkoutBaseUrl,
  });

  // Upload HTML
  const htmlKey = subPath
    ? `${slug}/${subPath}/index.html`
    : `${slug}/index.html`;

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

  // Upload assets
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

  const deployedUrl = subPath
    ? `${baseUrl}/${slug}/${subPath}`
    : `${baseUrl}/${slug}`;

  return { deployedUrl, r2Keys };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

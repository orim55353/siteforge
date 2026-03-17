import type { Job } from "bullmq";
import type { DeployJobData, DeployJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { deployToCloudflare, inferContentType } from "./cloudflare.js";
import type { SiteAsset } from "./cloudflare.js";

const SUPABASE_IMAGES_BUCKET = "site-images";

export async function processDeployJob(
  job: Job<DeployJobData, DeployJobResult>,
): Promise<DeployJobResult> {
  const { businessId, previewPageId } = job.data;

  // ── Fetch preview page and business ──
  const previewPage = await prisma.previewPage.findUniqueOrThrow({
    where: { id: previewPageId },
  });

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  if (business.status !== "page_generated") {
    throw new Error(
      `Business ${businessId} status is "${business.status}", expected "page_generated"`,
    );
  }

  if (!previewPage.htmlUrl) {
    throw new Error(
      `Preview page ${previewPageId} has no htmlUrl — page gen may have failed`,
    );
  }

  await job.log(`Deploying page for: ${business.name} (slug: ${previewPage.slug})`);

  // ── Fetch HTML from Supabase Storage ──
  await job.log(`Fetching HTML from Supabase Storage: ${previewPage.htmlUrl}`);
  const htmlRes = await fetch(previewPage.htmlUrl);
  if (!htmlRes.ok) {
    throw new Error(
      `Failed to fetch HTML from storage (${htmlRes.status}): ${previewPage.htmlUrl}`,
    );
  }
  const html = await htmlRes.text();
  await job.log(`Fetched HTML (${html.length} bytes)`);

  // ── Fetch images from Supabase Storage ──
  const assets = await fetchBusinessImages(previewPage.slug, job);

  // ── Deploy to Cloudflare R2 ──
  const { deployedUrl, r2Keys } = await deployToCloudflare(previewPage.slug, html, assets, business.name);
  await job.log(`Uploaded to Cloudflare R2: ${deployedUrl} (${r2Keys.length} files)`);

  // ── Create intent_pages row ──
  const intentPage = await prisma.intentPage.create({
    data: {
      businessId,
      slug: previewPage.slug,
      templateId: previewPage.templateId,
      aiContent: previewPage.aiContent as object,
      htmlUrl: previewPage.htmlUrl,
      deployedUrl,
    },
  });

  // ── Update business status ──
  await prisma.business.update({
    where: { id: businessId },
    data: { status: "page_deployed" },
  });

  await job.log(`Intent page created: ${intentPage.id}, status → page_deployed`);

  return {
    intentPageId: intentPage.id,
    deployedUrl,
  };
}

/**
 * Fetch all images for a business from Supabase Storage.
 *
 * Images are stored in the "site-images" bucket under {slug}/ prefix.
 * e.g. site-images/{slug}/hero.jpg, site-images/{slug}/gallery-1.jpg
 *
 * If no images exist or the bucket doesn't exist, returns an empty array
 * (pages work fine without images).
 */
async function fetchBusinessImages(
  slug: string,
  job: Job,
): Promise<SiteAsset[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) return [];

  // List files in the slug folder
  const listUrl = `${supabaseUrl}/storage/v1/object/list/${SUPABASE_IMAGES_BUCKET}`;
  const listRes = await fetch(listUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: `${slug}/`, limit: 100 }),
  });

  if (!listRes.ok) {
    // Bucket may not exist yet — that's fine, just no images
    await job.log(`No images bucket or folder found for ${slug} (${listRes.status})`);
    return [];
  }

  const files = (await listRes.json()) as Array<{ name: string }>;
  const imageFiles = files.filter((f) => /\.(jpg|jpeg|png|webp|avif|svg|gif)$/i.test(f.name));

  if (imageFiles.length === 0) {
    await job.log("No images found for this business");
    return [];
  }

  await job.log(`Found ${imageFiles.length} images to deploy`);

  // Download each image in parallel
  const assets: SiteAsset[] = [];
  const downloadResults = await Promise.allSettled(
    imageFiles.map(async (file) => {
      const fileUrl = `${supabaseUrl}/storage/v1/object/${SUPABASE_IMAGES_BUCKET}/${slug}/${file.name}`;
      const res = await fetch(fileUrl, {
        headers: { Authorization: `Bearer ${supabaseKey}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch image ${file.name}: ${res.status}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        filename: file.name,
        body: buffer,
        contentType: inferContentType(file.name),
      };
    }),
  );

  for (const result of downloadResults) {
    if (result.status === "fulfilled") {
      assets.push(result.value);
    } else {
      await job.log(`Warning: ${result.reason}`);
    }
  }

  await job.log(`Downloaded ${assets.length} images (${imageFiles.length} total)`);
  return assets;
}

/**
 * Fetch and compress business photos from Google Maps via SerpAPI.
 *
 * Flow:
 * 1. Hit SerpAPI google_maps_photos engine
 * 2. Download full-res images
 * 3. Compress to WebP via sharp (max 1200px wide, quality 80)
 * 4. Upload to Supabase Storage under site-images/{slug}/
 * 5. Return list of stored filenames
 */

import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const SERP_BASE_URL = "https://serpapi.com/search.json";
const MAX_PHOTOS = 8;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const IMAGES_BUCKET = "site-images";

/** Compression settings */
const IMAGE_MAX_WIDTH = 1200;
const IMAGE_QUALITY = 80;

export interface StoredPhoto {
  /** Filename in Supabase Storage, e.g. "photo-1.webp" */
  filename: string;
  /** Full Supabase Storage public URL */
  publicUrl: string;
  /** Original Google source URL */
  sourceUrl: string;
  /** Compressed file size in bytes */
  sizeBytes: number;
}

interface SerpPhotosResponse {
  photos?: Array<{
    thumbnail?: string;
    image?: string;
  }>;
  error?: string;
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  return createClient(url, key);
}

async function fetchWithBackoff(url: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response;

    if (response.status === 429 || response.status >= 500) {
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1;
      console.warn(
        `[fetch-photos] HTTP ${response.status}, retrying in ${Math.round(delay + jitter)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay + jitter));
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      continue;
    }

    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Compress an image buffer to WebP format.
 * Resizes to max width while preserving aspect ratio.
 */
async function compressImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();
}

/**
 * Fetch Google Maps photos for a business, compress them,
 * and upload to Supabase Storage.
 *
 * @param slug     — site slug, used as the folder name in storage
 * @param dataId   — Google Maps data_id (required by SerpAPI photos engine)
 * @param apiKey   — SerpAPI key
 * @param maxPhotos — max photos to fetch (default 8)
 */
export async function fetchAndStorePhotos(opts: {
  slug: string;
  dataId: string;
  apiKey: string;
  maxPhotos?: number;
}): Promise<StoredPhoto[]> {
  const { slug, dataId, apiKey, maxPhotos = MAX_PHOTOS } = opts;

  // ── 1. Fetch photo URLs from SerpAPI ──
  const params = new URLSearchParams({
    engine: "google_maps_photos",
    data_id: dataId,
    api_key: apiKey,
    hl: "en",
  });

  const serpUrl = `${SERP_BASE_URL}?${params}`;
  console.log(`[fetch-photos] Fetching photos for data_id: ${dataId}`);

  const response = await fetchWithBackoff(serpUrl);
  const data = (await response.json()) as SerpPhotosResponse;

  if (data.error) {
    console.error(`[fetch-photos] SerpAPI error: ${data.error}`);
    return [];
  }

  const photos = data.photos ?? [];
  if (photos.length === 0) {
    console.log("[fetch-photos] No photos returned by SerpAPI");
    return [];
  }

  // Prefer full-res images, fall back to thumbnails
  const imageUrls = photos
    .map((p) => p.image ?? p.thumbnail)
    .filter((url): url is string => Boolean(url))
    .slice(0, maxPhotos);

  console.log(`[fetch-photos] Found ${imageUrls.length} photo URLs`);

  // ── 2. Download, compress, and upload ──
  const supabase = getSupabaseClient();

  // Ensure bucket exists
  await supabase.storage.createBucket(IMAGES_BUCKET, { public: true });

  const stored: StoredPhoto[] = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
    const batch = imageUrls.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (sourceUrl, batchIdx) => {
        const photoIndex = i + batchIdx + 1;
        const filename = `photo-${photoIndex}.webp`;

        // Download original
        const imgRes = await fetchWithBackoff(sourceUrl);
        const originalBuffer = Buffer.from(await imgRes.arrayBuffer());
        console.log(
          `[fetch-photos] Downloaded photo-${photoIndex} (${(originalBuffer.length / 1024).toFixed(0)}KB)`,
        );

        // Compress
        const compressed = await compressImage(originalBuffer);
        console.log(
          `[fetch-photos] Compressed photo-${photoIndex}: ${(originalBuffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB`,
        );

        // Upload to Supabase Storage
        const storagePath = `${slug}/${filename}`;
        const { error: uploadError } = await supabase.storage
          .from(IMAGES_BUCKET)
          .upload(storagePath, compressed, {
            contentType: "image/webp",
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`Upload failed for ${filename}: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
          .from(IMAGES_BUCKET)
          .getPublicUrl(storagePath);

        return {
          filename,
          publicUrl: urlData.publicUrl,
          sourceUrl,
          sizeBytes: compressed.length,
        };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        stored.push(result.value);
      } else {
        console.error(`[fetch-photos] Failed: ${result.reason}`);
      }
    }
  }

  console.log(`[fetch-photos] Stored ${stored.length}/${imageUrls.length} photos for ${slug}`);
  return stored;
}

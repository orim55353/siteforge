// ─── SerpAPI Google Maps Reviews Fetcher ──────────────────────

const SERP_BASE_URL = "https://serpapi.com/search.json";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;

export interface GoogleReview {
  author: string;
  rating: number;
  text: string;
  date: string;
  isLocalGuide: boolean;
}

interface SerpReviewUser {
  name: string;
  local_guide?: boolean;
}

interface SerpReview {
  rating: number;
  snippet?: string;
  iso_date?: string;
  date?: string;
  user?: SerpReviewUser;
}

interface SerpReviewsResponse {
  reviews?: SerpReview[];
  error?: string;
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
        `[fetch-reviews] HTTP ${response.status}, retrying in ${Math.round(delay + jitter)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay + jitter));
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      continue;
    }

    throw new Error(`SerpAPI error: HTTP ${response.status} ${response.statusText}`);
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Fetch top Google reviews for a business via SerpAPI.
 *
 * Requires either `dataId` or `placeId`. Prefers `dataId` (more reliable).
 * Returns up to `maxReviews` reviews sorted by relevance (qualityScore).
 */
export async function fetchGoogleReviews(opts: {
  dataId?: string | null;
  placeId?: string | null;
  apiKey: string;
  maxReviews?: number;
}): Promise<GoogleReview[]> {
  const { dataId, placeId, apiKey, maxReviews = 5 } = opts;

  if (!dataId && !placeId) {
    console.warn("[fetch-reviews] No data_id or place_id — skipping reviews");
    return [];
  }

  const params = new URLSearchParams({
    engine: "google_maps_reviews",
    api_key: apiKey,
    sort_by: "qualityScore",
    hl: "en",
  });

  if (dataId) {
    params.set("data_id", dataId);
  } else {
    params.set("place_id", placeId!);
  }

  const url = `${SERP_BASE_URL}?${params}`;
  const response = await fetchWithBackoff(url);
  const data = (await response.json()) as SerpReviewsResponse;

  if (data.error) {
    console.error(`[fetch-reviews] SerpAPI error: ${data.error}`);
    return [];
  }

  const reviews = data.reviews ?? [];

  return reviews
    .filter((r) => r.snippet && r.snippet.length > 20)
    .slice(0, maxReviews)
    .map((r) => ({
      author: r.user?.name ?? "Anonymous",
      rating: r.rating,
      text: r.snippet!,
      date: r.iso_date ?? r.date ?? "",
      isLocalGuide: r.user?.local_guide ?? false,
    }));
}

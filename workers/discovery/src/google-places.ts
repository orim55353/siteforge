// ─── Google Places API Client with Exponential Backoff ─────

export interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  geometry?: {
    location: { lat: number; lng: number };
  };
  types?: string[];
  business_status?: string;
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

interface TextSearchResponse {
  results: Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    geometry?: { location: { lat: number; lng: number } };
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
    business_status?: string;
  }>;
  next_page_token?: string;
  status: string;
  error_message?: string;
}

interface PlaceDetailsResponse {
  result: PlaceResult;
  status: string;
  error_message?: string;
}

const PLACES_BASE_URL = "https://maps.googleapis.com/maps/api/place";

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * Fetch with exponential backoff for rate-limit (429) and server errors (5xx).
 */
async function fetchWithBackoff(url: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url);

    if (response.ok) return response;

    // Retry on rate limit or server errors
    if (response.status === 429 || response.status >= 500) {
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1;
      console.warn(
        `[discovery] HTTP ${response.status}, retrying in ${Math.round(delay + jitter)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay + jitter));
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      continue;
    }

    // Non-retryable error
    throw new Error(`Google Places API error: HTTP ${response.status} ${response.statusText}`);
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Search for businesses matching an industry + city query.
 * Paginates through all results up to maxResults (default 60, Google max).
 */
export async function searchPlaces(
  query: string,
  apiKey: string,
  maxResults: number = 60,
): Promise<PlaceResult[]> {
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;

  while (results.length < maxResults) {
    const params = new URLSearchParams({
      query,
      key: apiKey,
    });
    if (pageToken) {
      params.set("pagetoken", pageToken);
    }

    const url = `${PLACES_BASE_URL}/textsearch/json?${params}`;
    const response = await fetchWithBackoff(url);
    const data = (await response.json()) as TextSearchResponse;

    if (data.status === "ZERO_RESULTS") break;

    if (data.status !== "OK") {
      throw new Error(
        `Google Places Text Search error: ${data.status} — ${data.error_message ?? "unknown"}`,
      );
    }

    // Fetch details for each place (phone, website, address components)
    const detailed = await Promise.all(
      data.results.map((r) => getPlaceDetails(r.place_id, apiKey)),
    );
    results.push(...detailed);

    pageToken = data.next_page_token;
    if (!pageToken) break;

    // Google requires a short delay before using next_page_token
    await new Promise((r) => setTimeout(r, 2_000));
  }

  return results.slice(0, maxResults);
}

/**
 * Get detailed information for a single place.
 */
async function getPlaceDetails(placeId: string, apiKey: string): Promise<PlaceResult> {
  const fields = [
    "place_id",
    "name",
    "formatted_address",
    "formatted_phone_number",
    "international_phone_number",
    "website",
    "rating",
    "user_ratings_total",
    "geometry",
    "types",
    "business_status",
    "address_components",
  ].join(",");

  const params = new URLSearchParams({
    place_id: placeId,
    fields,
    key: apiKey,
  });

  const url = `${PLACES_BASE_URL}/details/json?${params}`;
  const response = await fetchWithBackoff(url);
  const data = (await response.json()) as PlaceDetailsResponse;

  if (data.status !== "OK") {
    throw new Error(
      `Google Places Details error for ${placeId}: ${data.status} — ${data.error_message ?? "unknown"}`,
    );
  }

  return data.result;
}

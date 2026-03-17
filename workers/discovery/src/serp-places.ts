// ─── SerpAPI Google Maps Client with Exponential Backoff ─────

export interface PlaceResult {
  place_id: string;
  data_id?: string;
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

interface SerpLocalResult {
  place_id: string;
  data_id?: string;
  title: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  gps_coordinates?: { latitude: number; longitude: number };
  type?: string;
  types?: string[];
}

interface SerpSearchResponse {
  local_results?: SerpLocalResult[];
  error?: string;
  search_metadata?: {
    status: string;
  };
}

const SERP_BASE_URL = "https://serpapi.com/search.json";
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1_000;

async function fetchWithBackoff(url: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url);

    if (response.ok) return response;

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

    throw new Error(`SerpAPI error: HTTP ${response.status} ${response.statusText}`);
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Convert a SerpAPI local result into our standard PlaceResult format.
 */
function toPlaceResult(result: SerpLocalResult): PlaceResult {
  return {
    place_id: result.place_id,
    data_id: result.data_id,
    name: result.title,
    formatted_address: result.address,
    formatted_phone_number: result.phone ?? undefined,
    website: result.website,
    rating: result.rating,
    user_ratings_total: result.reviews,
    geometry: result.gps_coordinates
      ? {
          location: {
            lat: result.gps_coordinates.latitude,
            lng: result.gps_coordinates.longitude,
          },
        }
      : undefined,
    types: result.types ?? (result.type ? [result.type] : undefined),
    business_status: "OPERATIONAL",
  };
}

/**
 * Search for businesses matching an industry + city query via SerpAPI.
 * Uses Google Maps engine for local business results.
 */
export async function searchPlaces(
  query: string,
  apiKey: string,
  maxResults: number = 60,
): Promise<PlaceResult[]> {
  const results: PlaceResult[] = [];
  let start = 0;

  while (results.length < maxResults) {
    const params = new URLSearchParams({
      engine: "google_maps",
      q: query,
      api_key: apiKey,
      type: "search",
      start: String(start),
    });

    const url = `${SERP_BASE_URL}?${params}`;
    const response = await fetchWithBackoff(url);
    const data = (await response.json()) as SerpSearchResponse;

    if (data.error) {
      // "No results" is not a fatal error — just means nothing matched
      if (data.error.toLowerCase().includes("hasn't returned any results")) {
        break;
      }
      throw new Error(`SerpAPI error: ${data.error}`);
    }

    const localResults = data.local_results ?? [];
    if (localResults.length === 0) break;

    const places = localResults.map(toPlaceResult);
    results.push(...places);

    // SerpAPI returns ~20 results per page
    start += localResults.length;

    // If we got fewer than 20, there are no more pages
    if (localResults.length < 20) break;
  }

  return results.slice(0, maxResults);
}

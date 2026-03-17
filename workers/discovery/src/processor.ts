import type { Job } from "bullmq";
import type { DiscoveryJobData, DiscoveryJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { enrichmentQueue } from "@lead-gen/queue";
import { searchPlaces, type PlaceResult } from "./serp-places.js";

/**
 * Extract city/state/zip from Google's address_components.
 */
function parseAddress(place: PlaceResult) {
  const components = place.address_components ?? [];
  const get = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name ?? null;

  return {
    city: get("locality") ?? get("sublocality"),
    state: get("administrative_area_level_1"),
    zipCode: get("postal_code"),
  };
}

/**
 * Process a discovery job: search Google Places, deduplicate, insert new businesses.
 */
export async function processDiscoveryJob(
  job: Job<DiscoveryJobData, DiscoveryJobResult>,
): Promise<DiscoveryJobResult> {
  const { marketId, industry, city, state, country, maxResults } = job.data;

  const query = `${industry} in ${city}, ${state}${country && country !== "US" ? `, ${country}` : ""}`;

  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) {
    throw new Error("SERP_API_KEY is not set");
  }

  await job.log(`Searching SerpAPI Google Maps: "${query}"`);
  const places = await searchPlaces(query, apiKey, maxResults);
  await job.log(`Found ${places.length} results from SerpAPI`);

  // Save MarketScan analytics
  const withWebsiteCount = places.filter((p) => p.website).length;
  const withoutWebsiteCount = places.filter((p) => !p.website).length;
  const qualifyingPlaces = places.filter((p) => {
    if (p.website) return false;
    if ((p.rating ?? 0) < 4.0) return false;
    if ((p.user_ratings_total ?? 0) < 50) return false;
    return true;
  });
  const allRatings = places.map((p) => p.rating ?? 0);
  const allReviews = places.map((p) => p.user_ratings_total ?? 0);
  const avgRating = allRatings.length > 0
    ? Math.round((allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 100) / 100
    : 0;
  const avgReviews = allReviews.length > 0
    ? Math.round(allReviews.reduce((a, b) => a + b, 0) / allReviews.length)
    : 0;

  await prisma.marketScan.upsert({
    where: { query },
    update: {
      rawResults: JSON.parse(JSON.stringify(places)),
      totalResults: places.length,
      withWebsite: withWebsiteCount,
      withoutWebsite: withoutWebsiteCount,
      qualifying: qualifyingPlaces.length,
      avgRating,
      avgReviews,
      topBusinesses: qualifyingPlaces.slice(0, 10).map((p) => ({
        name: p.name,
        rating: p.rating ?? 0,
        reviews: p.user_ratings_total ?? 0,
        address: p.formatted_address ?? null,
        phone: p.formatted_phone_number ?? null,
      })),
      scannedAt: new Date(),
    },
    create: {
      industry,
      city,
      state,
      query,
      rawResults: JSON.parse(JSON.stringify(places)),
      totalResults: places.length,
      withWebsite: withWebsiteCount,
      withoutWebsite: withoutWebsiteCount,
      qualifying: qualifyingPlaces.length,
      avgRating,
      avgReviews,
      topBusinesses: qualifyingPlaces.slice(0, 10).map((p) => ({
        name: p.name,
        rating: p.rating ?? 0,
        reviews: p.user_ratings_total ?? 0,
        address: p.formatted_address ?? null,
        phone: p.formatted_phone_number ?? null,
      })),
    },
  });
  await job.log(`MarketScan saved: ${places.length} total, ${withWebsiteCount} with website, ${qualifyingPlaces.length} qualifying`);

  if (places.length === 0) {
    return { businessIds: [], count: 0 };
  }

  // Deduplicate: find which google_place_ids already exist
  const placeIds = places.map((p) => p.place_id);
  const existing = await prisma.business.findMany({
    where: { googlePlaceId: { in: placeIds } },
    select: { googlePlaceId: true },
  });
  const existingIds = new Set(existing.map((b) => b.googlePlaceId));
  const deduped = places.filter((p) => !existingIds.has(p.place_id));

  // Filter: only businesses with NO website, 4.0+ rating, and 50+ reviews
  const newPlaces = deduped.filter((p) => {
    if (p.website) return false;
    if ((p.rating ?? 0) < 4.0) return false;
    if ((p.user_ratings_total ?? 0) < 50) return false;
    return true;
  });

  const filtered = deduped.length - newPlaces.length;
  await job.log(
    `${existingIds.size} already in DB, ${deduped.length} new, ${filtered} filtered out (has website / low rating / few reviews), ${newPlaces.length} to insert`,
  );

  if (newPlaces.length === 0) {
    return { businessIds: [], count: 0 };
  }

  // Batch insert new businesses
  const insertedIds: string[] = [];

  for (const place of newPlaces) {
    const addr = parseAddress(place);
    const googleMapsUrl = place.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
      : null;

    const business = await prisma.business.create({
      data: {
        marketId,
        status: "discovered",
        googlePlaceId: place.place_id,
        googleDataId: place.data_id ?? null,
        googleMapsUrl,
        name: place.name,
        phone: place.formatted_phone_number ?? place.international_phone_number ?? null,
        website: place.website ?? null,
        address: place.formatted_address ?? null,
        city: addr.city,
        state: addr.state,
        zipCode: addr.zipCode,
        latitude: place.geometry?.location.lat ?? null,
        longitude: place.geometry?.location.lng ?? null,
        googleRating: place.rating ?? null,
        reviewCount: place.user_ratings_total ?? 0,
        categories: place.types ?? [],
      },
      select: { id: true },
    });
    insertedIds.push(business.id);
  }

  await job.log(`Inserted ${insertedIds.length} businesses`);

  // Enqueue enrichment jobs for each new business
  const enrichmentJobs = insertedIds.map((id) => ({
    name: `enrich-${id}`,
    data: { businessId: id },
  }));
  await enrichmentQueue.addBulk(enrichmentJobs);
  await job.log(`Enqueued ${enrichmentJobs.length} enrichment jobs`);

  return { businessIds: insertedIds, count: insertedIds.length };
}

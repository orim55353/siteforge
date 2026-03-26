import type { EnrichmentJobData, EnrichmentJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { processScoringJob } from "@lead-gen/worker-scoring";
import { auditWebsite } from "./website-audit.js";
import { aiEnrichWebsite, type AiEnrichmentResult } from "./ai-enrichment.js";
import { normalizePhone } from "./phone-utils.js";
import { timezoneFromState } from "./timezone-lookup.js";
import { fetchGoogleReviews } from "./fetch-reviews.js";
import { fetchAndStorePhotos } from "./fetch-photos.js";
import type { StoredPhoto } from "./fetch-photos.js";

function generateSlug(name: string, city: string | null, id: string): string {
  const base = [name, city].filter(Boolean).join("-");
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${clean}-${id.slice(0, 8)}`;
}

export async function processEnrichmentJob(
  data: EnrichmentJobData,
): Promise<EnrichmentJobResult> {
  const { businessId } = data;

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  if (business.status !== "discovered") {
    console.log(`[enrichment] Skipping — status is "${business.status}", not "discovered"`);
    return { businessId, websiteScore: business.websiteScore };
  }

  console.log(`[enrichment] Enriching business: ${business.name}`);

  // ── Website audit ──
  let hasWebsite = false;
  let websiteScore: number | null = null;
  let hasSsl = false;
  let isMobileFriendly = false;
  let hasOnlineBooking = false;
  let techStack: string[] = [];
  let socialProfiles: Record<string, string> = {};

  let websiteHtml: string | null = null;

  if (business.website) {
    console.log(`[enrichment] Auditing website: ${business.website}`);
    const audit = await auditWebsite(business.website);
    hasWebsite = audit.loads;
    websiteScore = audit.score;
    hasSsl = audit.hasSsl;
    isMobileFriendly = audit.isMobileFriendly;
    hasOnlineBooking = audit.hasOnlineBooking;
    techStack = audit.techStack;
    socialProfiles = audit.socialProfiles;
    websiteHtml = audit.loads ? audit.html : null;
    console.log(`[enrichment] Website score: ${audit.score}/100 (loads: ${audit.loads})`);
  } else {
    console.log("[enrichment] No website URL — skipping audit");
  }

  // ── AI enrichment (Claude CLI analysis) ──
  let aiInsights: AiEnrichmentResult | null = null;
  console.log("[enrichment] Running AI enrichment via Claude...");
  try {
    aiInsights = await aiEnrichWebsite({
      businessName: business.name,
      category: business.categories?.[0] ?? null,
      city: business.city,
      state: business.state,
      googleRating: business.googleRating,
      reviewCount: business.reviewCount,
      categories: business.categories ?? [],
      html: websiteHtml,
    });
    console.log(`[enrichment] AI insights: ${aiInsights.designQuality} design, ${aiInsights.services.length} services, ${aiInsights.painPoints.length} pain points`);
    if (aiInsights.owner?.ownerName) {
      console.log(`[enrichment] Owner found: ${aiInsights.owner.ownerName} (${aiInsights.owner.ownerTitle ?? "unknown role"})`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[enrichment] AI enrichment failed (non-fatal): ${message}`);
  }

  // ── Phone normalization ──
  const normalizedPhone = business.phone ? normalizePhone(business.phone) : null;

  // ── Timezone lookup ──
  const timezone = business.state
    ? timezoneFromState(business.state)
    : "America/Chicago";

  console.log(`[enrichment] Timezone: ${timezone}`);

  // ── Fetch Google reviews ──
  let reviews: Awaited<ReturnType<typeof fetchGoogleReviews>> = [];
  const serpApiKey = process.env.SERP_API_KEY;
  if (serpApiKey && (business.googleDataId || business.googlePlaceId)) {
    console.log("[enrichment] Fetching Google reviews via SerpAPI...");
    reviews = await fetchGoogleReviews({
      dataId: business.googleDataId,
      placeId: business.googlePlaceId,
      apiKey: serpApiKey,
      maxReviews: 5,
    });
    console.log(`[enrichment] Fetched ${reviews.length} reviews`);
  } else {
    console.log("[enrichment] Skipping reviews — no SERP_API_KEY or no place identifier");
  }

  // ── Fetch Google Maps photos ──
  let photos: StoredPhoto[] = [];
  if (serpApiKey && business.googleDataId) {
    const slug = generateSlug(business.name, business.city, business.id);
    console.log(`[enrichment] Fetching Google Maps photos for slug: ${slug}`);
    photos = await fetchAndStorePhotos({
      slug,
      dataId: business.googleDataId,
      apiKey: serpApiKey,
      maxPhotos: 8,
    });
    console.log(`[enrichment] Stored ${photos.length} compressed photos`);
  } else {
    console.log("[enrichment] Skipping photos — no SERP_API_KEY or no google_data_id");
  }

  // ── Extract owner details from AI insights ──
  const ownerData = aiInsights?.owner ?? null;

  // ── Update business ──
  await prisma.business.update({
    where: { id: businessId },
    data: {
      status: "enriched",
      hasWebsite,
      websiteScore,
      hasSsl,
      isMobileFriendly,
      hasOnlineBooking,
      techStack,
      socialProfiles,
      phone: normalizedPhone ?? business.phone,
      timezone,
      reviews: reviews.length > 0 ? JSON.parse(JSON.stringify(reviews)) : undefined,
      photos: photos.length > 0 ? JSON.parse(JSON.stringify(photos)) : undefined,
      aiInsights: aiInsights ? JSON.parse(JSON.stringify(aiInsights)) : undefined,
      ownerName: ownerData?.ownerName ?? undefined,
      ownerEmail: ownerData?.ownerEmail ?? undefined,
      ownerPhone: ownerData?.ownerPhone ?? undefined,
      ownerTitle: ownerData?.ownerTitle ?? undefined,
    },
  });

  console.log("[enrichment] Business updated to enriched");

  // ── Call scoring directly (no queue) ──
  console.log("[enrichment] Running scoring...");
  await processScoringJob({ businessId });
  console.log("[enrichment] Scoring complete");

  return { businessId, websiteScore };
}

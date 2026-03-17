import type {
  BusinessInput,
  ReviewInput,
  PhotoInput,
  AiInsightsInput,
} from "./types.js";

export function formatReviews(reviews: unknown): string | null {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;

  const lines = reviews.map((r: ReviewInput, i: number) => {
    const guide = r.isLocalGuide ? " (Local Guide)" : "";
    return `  ${i + 1}. "${r.text}" — ${r.author}${guide}, ${r.rating}/5 stars`;
  });

  return `Real Google reviews (use these EXACTLY as testimonials on the page — do NOT make up fake reviews):\n${lines.join("\n")}`;
}

export function formatPhotos(photos: unknown, categories: string[]): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;

  const categoryHint =
    categories.length > 0
      ? `This is a ${categories.join(" / ")} business.`
      : "";

  const photoLines = photos.map(
    (p: PhotoInput, i: number) => `  ${i + 1}. ${p.publicUrl}`,
  );

  return [
    `Real business photos (${photos.length} available):`,
    categoryHint,
    ...photoLines,
    "",
    "Image placement guidance:",
    "- Study the business categories and name to understand what these photos likely show (storefront, food, interior, team, work examples, etc.)",
    "- Use images where they reinforce the message — hero backgrounds, service showcases, gallery sections, testimonial backdrops",
    "- Apply appropriate CSS treatments: object-fit cover, rounded corners, overlays for text readability, aspect ratios that suit the content",
    "- Do NOT use every photo — pick the 3-5 that would have the strongest visual impact",
    '- Add descriptive alt text inferred from the business type (e.g., alt="Interior of [business name]" for a restaurant interior shot)',
  ].join("\n");
}

export function formatAiInsights(
  insights: AiInsightsInput | null | undefined,
): string | null {
  if (!insights) return null;

  const lines: string[] = [];

  if (insights.services?.length) {
    lines.push(
      `Services this business offers: ${insights.services.join(", ")}`,
    );
  }
  if (insights.uniqueSellingPoints?.length) {
    lines.push(
      `What makes them stand out: ${insights.uniqueSellingPoints.join("; ")}`,
    );
  }
  if (insights.painPoints?.length) {
    lines.push(
      `Their digital presence gaps (use these to inform the page design — show them what they're missing): ${insights.painPoints.join("; ")}`,
    );
  }
  if (insights.outreachAngles?.length) {
    lines.push(
      `Key value propositions to emphasize on the page: ${insights.outreachAngles.join("; ")}`,
    );
  }
  if (insights.summary) {
    lines.push(`Business summary: ${insights.summary}`);
  }

  return lines.length > 0
    ? `\nAI-researched business insights (use these to personalize the page):\n${lines.join("\n")}`
    : null;
}

export function buildBusinessContext(business: BusinessInput): string {
  const parts = [
    `Business name: ${business.name}`,
    business.phone && `Phone: ${business.phone}`,
    business.email && `Email: ${business.email}`,
    business.city &&
      business.state &&
      `Location: ${business.city}, ${business.state}`,
    business.address && `Address: ${business.address}`,
    business.categories?.length &&
      `Categories: ${business.categories.join(", ")}`,
    business.googleRating &&
      `Google rating: ${business.googleRating}/5 (${business.reviewCount ?? 0} reviews)`,
    business.googleMapsUrl && `Google Maps: ${business.googleMapsUrl}`,
    business.website && `Current website: ${business.website}`,
    formatReviews(business.reviews),
    formatPhotos(business.photos, business.categories ?? []),
    formatAiInsights(business.aiInsights),
  ];
  return parts.filter(Boolean).join("\n");
}

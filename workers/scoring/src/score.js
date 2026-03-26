import { config } from "./config.js";
/**
 * Pure deterministic scoring function.
 * Returns a lead_score 0-100 and qualification decision.
 */
export function scoreBusiness(input) {
    const { googleRating, reviewCount, websiteScore, hasWebsite } = input;
    const reasons = [];
    // ── Qualification gates ──
    const rating = googleRating ?? 0;
    const reviews = reviewCount ?? 0;
    const passesRating = rating >= config.minRating;
    const passesReviews = reviews >= config.minReviewCount;
    // Only businesses with NO website qualify
    const passesWebsite = !hasWebsite;
    if (!passesRating)
        reasons.push(`rating ${rating} < ${config.minRating}`);
    if (!passesReviews)
        reasons.push(`reviews ${reviews} < ${config.minReviewCount}`);
    if (!passesWebsite)
        reasons.push(`business has a website — only businesses without websites qualify`);
    const qualified = passesRating && passesReviews && passesWebsite;
    // ── Component scores (each 0-100) ──
    // Rating: linear scale from 3.0 (0) to 5.0 (100)
    const ratingScore = Math.round(Math.min(100, Math.max(0, ((rating - 3.0) / 2.0) * 100)));
    // Reviews: logarithmic scale, capped
    const clampedReviews = Math.min(reviews, config.reviewCountCap);
    const reviewScore = clampedReviews <= 0
        ? 0
        : Math.round(Math.min(100, (Math.log(clampedReviews + 1) / Math.log(config.reviewCountCap + 1)) * 100));
    // Website opportunity: higher score = worse website = better opportunity
    const websiteOpportunityScore = !hasWebsite
        ? 100
        : websiteScore !== null
            ? Math.round(Math.min(100, Math.max(0, 100 - websiteScore)))
            : 50; // unknown website quality → neutral
    // ── Weighted total ──
    const totalScore = Math.round(ratingScore * config.weightRating +
        reviewScore * config.weightReviews +
        websiteOpportunityScore * config.weightWebsite);
    return {
        ratingScore,
        reviewScore,
        websiteScore: websiteOpportunityScore,
        totalScore,
        qualified,
        reasons,
    };
}
//# sourceMappingURL=score.js.map
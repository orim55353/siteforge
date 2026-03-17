// Scoring thresholds — configurable via environment variables

export const config = {
  // Qualification thresholds
  minRating: parseFloat(process.env.SCORING_MIN_RATING ?? "4.0"),
  minReviewCount: parseInt(process.env.SCORING_MIN_REVIEW_COUNT ?? "50", 10),
  maxWebsiteScore: parseInt(process.env.SCORING_MAX_WEBSITE_SCORE ?? "60", 10),

  // Score weights (must sum to 1.0)
  weightRating: parseFloat(process.env.SCORING_WEIGHT_RATING ?? "0.30"),
  weightReviews: parseFloat(process.env.SCORING_WEIGHT_REVIEWS ?? "0.30"),
  weightWebsite: parseFloat(process.env.SCORING_WEIGHT_WEBSITE ?? "0.40"),

  // Review count scoring caps
  reviewCountCap: parseInt(process.env.SCORING_REVIEW_COUNT_CAP ?? "200", 10),
};

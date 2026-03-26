export interface ScoreBreakdown {
    ratingScore: number;
    reviewScore: number;
    websiteScore: number;
    totalScore: number;
    qualified: boolean;
    reasons: string[];
}
/**
 * Pure deterministic scoring function.
 * Returns a lead_score 0-100 and qualification decision.
 */
export declare function scoreBusiness(input: {
    googleRating: number | null;
    reviewCount: number | null;
    websiteScore: number | null;
    hasWebsite: boolean;
}): ScoreBreakdown;
//# sourceMappingURL=score.d.ts.map
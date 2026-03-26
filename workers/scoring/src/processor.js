import { prisma } from "@lead-gen/db";
import { scoreBusiness } from "./score.js";
export async function processScoringJob(data) {
    const { businessId } = data;
    const business = await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
    });
    if (business.status !== "enriched") {
        console.log(`[scoring] Skipping — status is "${business.status}", not "enriched"`);
        return { businessId, score: business.score ?? 0, qualified: false };
    }
    console.log(`[scoring] Scoring business: ${business.name}`);
    const result = scoreBusiness({
        googleRating: business.googleRating ? Number(business.googleRating) : null,
        reviewCount: business.reviewCount,
        websiteScore: business.websiteScore,
        hasWebsite: business.hasWebsite ?? false,
    });
    console.log(`[scoring] Score: ${result.totalScore}/100 | Qualified: ${result.qualified} | ` +
        `Rating: ${result.ratingScore} Reviews: ${result.reviewScore} Website: ${result.websiteScore}`);
    if (result.reasons.length > 0) {
        console.log(`[scoring] Disqualification reasons: ${result.reasons.join(", ")}`);
    }
    const newStatus = result.qualified ? "qualified" : "disqualified";
    await prisma.business.update({
        where: { id: businessId },
        data: {
            status: newStatus,
            score: result.totalScore,
            scoreBreakdown: {
                ratingScore: result.ratingScore,
                reviewScore: result.reviewScore,
                websiteScore: result.websiteScore,
                qualified: result.qualified,
                reasons: result.reasons,
            },
        },
    });
    console.log(`[scoring] Business updated to ${newStatus}`);
    return {
        businessId,
        score: result.totalScore,
        qualified: result.qualified,
    };
}
//# sourceMappingURL=processor.js.map
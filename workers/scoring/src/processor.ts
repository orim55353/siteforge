import type { Job } from "bullmq";
import type { ScoringJobData, ScoringJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import { scoreBusiness } from "./score.js";

export async function processScoringJob(
  job: Job<ScoringJobData, ScoringJobResult>,
): Promise<ScoringJobResult> {
  const { businessId } = job.data;

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  if (business.status !== "enriched") {
    await job.log(`Skipping — status is "${business.status}", not "enriched"`);
    return { businessId, score: business.score ?? 0, qualified: false };
  }

  await job.log(`Scoring business: ${business.name}`);

  const result = scoreBusiness({
    googleRating: business.googleRating ? Number(business.googleRating) : null,
    reviewCount: business.reviewCount,
    websiteScore: business.websiteScore,
    hasWebsite: business.hasWebsite ?? false,
  });

  await job.log(
    `Score: ${result.totalScore}/100 | Qualified: ${result.qualified} | ` +
      `Rating: ${result.ratingScore} Reviews: ${result.reviewScore} Website: ${result.websiteScore}`,
  );

  if (result.reasons.length > 0) {
    await job.log(`Disqualification reasons: ${result.reasons.join(", ")}`);
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

  await job.log(`Business updated to ${newStatus}`);

  return {
    businessId,
    score: result.totalScore,
    qualified: result.qualified,
  };
}

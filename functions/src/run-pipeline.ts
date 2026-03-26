import type { Request, Response } from "express";
import { processDiscoveryJob } from "@lead-gen/worker-discovery";

/**
 * Pipeline orchestrator Cloud Function.
 *
 * Runs the full discovery → enrichment → scoring pipeline for a market.
 * Enrichment and scoring are called directly by the discovery processor.
 *
 * POST body:
 *   { marketId, industry, city, state, country?, maxResults? }
 *
 * This function can be triggered:
 *   - Manually via HTTP POST (admin dashboard / CLI)
 *   - Via Cloud Scheduler for periodic market scans
 */
export async function runPipeline(req: Request, res: Response): Promise<void> {
  try {
    const { marketId, industry, city, state, country, maxResults } = req.body;

    if (!marketId || !industry || !city || !state) {
      res.status(400).json({
        error: "Required fields: marketId, industry, city, state",
      });
      return;
    }

    console.log(`[pipeline] Starting pipeline for ${industry} in ${city}, ${state}`);

    const result = await processDiscoveryJob({
      marketId,
      industry,
      city,
      state,
      country,
      maxResults,
    });

    console.log(
      `[pipeline] Pipeline complete: ${result.count} businesses discovered and processed`,
    );

    res.status(200).json({
      success: true,
      businessIds: result.businessIds,
      count: result.count,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[pipeline] Pipeline failed:", message);
    res.status(500).json({ error: message });
  }
}

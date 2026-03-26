import type { Request, Response } from "express";
import { processExtraPagesJob } from "@lead-gen/worker-extra-pages";

/**
 * Extra pages generation Cloud Function.
 *
 * Generates about/services/gallery pages for a deployed landing page.
 * Called by the trackPageView function on first visit, or manually.
 *
 * POST body:
 *   { businessId, slug }
 */
export async function generateExtraPages(req: Request, res: Response): Promise<void> {
  try {
    const { businessId, slug } = req.body;

    if (!businessId || !slug) {
      res.status(400).json({ error: "Required fields: businessId, slug" });
      return;
    }

    console.log(`[extra-pages] Generating extra pages for slug=${slug}`);

    const result = await processExtraPagesJob({ businessId, slug });

    console.log(`[extra-pages] Generated ${result.previewPageIds.length} pages`);

    res.status(200).json({
      success: true,
      previewPageIds: result.previewPageIds,
      deployedUrls: result.deployedUrls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[extra-pages] Generation failed:", message);
    res.status(500).json({ error: message });
  }
}

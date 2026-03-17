import type { Job } from "bullmq";
import type { PageGenJobData, PageGenJobResult } from "@lead-gen/queue";
import { prisma } from "@lead-gen/db";
import type { BusinessInput } from "@lead-gen/ai";
import { generatePage } from "./ai-content.js";
import { uploadToSupabase } from "./storage.js";

export async function processPageGenJob(
  job: Job<PageGenJobData, PageGenJobResult>,
): Promise<PageGenJobResult> {
  const { businessId } = job.data;

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { market: true },
  });

  if (business.status !== "qualified") {
    await job.log(`Skipping — status is "${business.status}", not "qualified"`);
    throw new Error(`Business ${businessId} status is "${business.status}", expected "qualified"`);
  }

  await job.log(`Generating page for: ${business.name}`);

  // ── Generate full HTML page via Claude CLI ──
  await job.log("Calling Claude CLI to generate full HTML page...");
  const html = await generatePage(business as unknown as BusinessInput);
  await job.log(`HTML generated (${html.length} bytes)`);

  // ── Upload to Supabase Storage ──
  const slug = generateSlug(business.name, business.city, businessId);
  const htmlUrl = await uploadToSupabase(slug, html);
  await job.log(`Uploaded to Supabase Storage: ${htmlUrl}`);

  // ── Create preview_pages row ──
  const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? "https://draft.example.com";
  const previewUrl = `${previewBaseUrl}/${slug}`;

  const previewPage = await prisma.previewPage.create({
    data: {
      businessId,
      slug,
      templateId: "ai-generated",
      aiContent: { generator: "claude-opus-4-6", generatedAt: new Date().toISOString() },
      htmlUrl,
      previewUrl,
    },
  });

  // ── Update business status ──
  await prisma.business.update({
    where: { id: businessId },
    data: { status: "page_generated" },
  });

  await job.log(`Preview page created: ${previewPage.id}`);

  return { previewPageId: previewPage.id, slug };
}

function generateSlug(name: string, city: string | null, id: string): string {
  const base = [name, city].filter(Boolean).join("-");
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const shortId = id.slice(0, 8);
  return `${clean}-${shortId}`;
}

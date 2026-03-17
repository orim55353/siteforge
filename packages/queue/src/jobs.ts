// ─── Job Payload Interfaces ──────────────────────────────────

/** Discovery worker: find businesses in a market */
export interface DiscoveryJobData {
  marketId: string;
  industry: string;
  city: string;
  state: string;
  country?: string;
  maxResults?: number;
}

/** Enrichment worker: enrich a single business */
export interface EnrichmentJobData {
  businessId: string;
}

/** Scoring worker: score a single business */
export interface ScoringJobData {
  businessId: string;
}

/** Page generation worker: generate AI content + render HTML */
export interface PageGenJobData {
  businessId: string;
  templateId: string;
  campaignId?: string;
}

/** Deploy worker: upload to Supabase Storage + Cloudflare */
export interface DeployJobData {
  businessId: string;
  previewPageId: string;
}

/** Scheduler worker: schedule outreach for a business */
export interface SchedulerJobData {
  businessId: string;
  campaignId: string;
  sendAt?: string; // ISO datetime, computed from timezone if omitted
}

/** Email worker: send a single outreach email */
export interface EmailJobData {
  outreachMessageId: string;
}

/** Extra pages worker: generate additional pages (about, services, gallery) */
export interface ExtraPagesJobData {
  businessId: string;
  slug: string;
}

/** Reply ingestion: process an inbound email */
export interface ReplyIngestionJobData {
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  headers?: Record<string, string>;
}

// ─── Job Result Types ────────────────────────────────────────

export interface DiscoveryJobResult {
  businessIds: string[];
  count: number;
}

export interface EnrichmentJobResult {
  businessId: string;
  websiteScore: number | null;
}

export interface ScoringJobResult {
  businessId: string;
  score: number;
  qualified: boolean;
}

export interface PageGenJobResult {
  previewPageId: string;
  slug: string;
}

export interface DeployJobResult {
  intentPageId: string;
  deployedUrl: string;
}

export interface SchedulerJobResult {
  outreachMessageId: string;
  scheduledFor: string;
}

export interface EmailJobResult {
  outreachMessageId: string;
  resendId: string;
}

export interface ExtraPagesJobResult {
  previewPageIds: string[];
  deployedUrls: string[];
}

export interface ReplyIngestionJobResult {
  replyId: string;
  outreachMessageId: string | null;
  forwardedToFounder: boolean;
}

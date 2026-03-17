// ─── Claude CLI-powered website enrichment ──────────────────────
// Analyzes scraped HTML with Claude CLI to extract qualitative signals
// that Cheerio-based mechanical checks can't detect.
// Uses claude-haiku-4-5 via CLI for cost efficiency (~$0.001 per business).

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENRICHMENT_ROOT = join(__dirname, "..");

const CLI_TIMEOUT_MS = 60_000; // 60 seconds (web search + JSON response)
const MAX_HTML_CHARS = 30_000;

export interface OwnerInfo {
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  ownerTitle: string | null;
}

export interface AiEnrichmentResult {
  designQuality: "poor" | "basic" | "decent" | "professional" | "excellent";
  contentQuality: "poor" | "basic" | "decent" | "professional" | "excellent";
  services: string[];
  uniqueSellingPoints: string[];
  painPoints: string[];
  outreachAngles: string[];
  summary: string;
  owner: OwnerInfo;
}

/**
 * Run a prompt through the Claude Code CLI and return raw text output.
 * Uses claude-haiku-4-5 (not opus like page-gen) for cost/speed.
 */
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p", "--dangerously-skip-permissions", "--output-format", "text", "--model", "haiku"],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024, cwd: ENRICHMENT_ROOT, env: { ...process.env, CLAUDECODE: "" } },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[ai-enrichment] CLI error:", error.message);
          if (stderr) console.error("[ai-enrichment] stderr:", stderr);
          return reject(new Error(`Claude CLI failed: ${error.message}`));
        }

        const cleaned = stripAnsi(stdout).trim();
        resolve(cleaned);
      },
    );

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/** Strip ANSI escape codes from CLI output */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function truncateHtml(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned.length > MAX_HTML_CHARS
    ? cleaned.slice(0, MAX_HTML_CHARS)
    : cleaned;
}

/** Extract JSON from CLI output — handles markdown code fences */
function extractJson(raw: string): string {
  // Try markdown code fence first
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try to find raw JSON object
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    return raw.slice(jsonStart, jsonEnd + 1);
  }

  throw new Error("No JSON found in Claude CLI output");
}

export interface AiEnrichInput {
  businessName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  googleRating: number | null;
  reviewCount: number | null;
  categories: string[];
  html: string | null;
}

export async function aiEnrichWebsite(input: AiEnrichInput): Promise<AiEnrichmentResult> {
  const contextLines = [
    `Business: ${input.businessName}`,
    input.category ? `Primary category: ${input.category}` : null,
    input.categories.length > 1 ? `All categories: ${input.categories.join(", ")}` : null,
    input.city && input.state ? `Location: ${input.city}, ${input.state}` : null,
    input.googleRating ? `Google rating: ${input.googleRating}/5 (${input.reviewCount ?? 0} reviews)` : null,
  ].filter(Boolean).join("\n");

  const hasWebsite = input.html !== null;

  const searchStep = hasWebsite
    ? ""
    : `STEP 1 — QUICK WEB RESEARCH (mandatory):
Before analyzing, use WebSearch to search for "${input.businessName}" in ${input.city ?? ""}, ${input.state ?? ""}. Do 1-2 quick searches to find:
- Their social media pages (Facebook, Instagram, Yelp)
- Any directory listings or mentions
- What customers say about them online
- Any photos or menus they've posted elsewhere
Spend no more than 2 searches. Then use what you found in your analysis below.

STEP 2 — ANALYSIS:
`;

  const htmlSection = hasWebsite
    ? `\nWebsite HTML:\n${truncateHtml(input.html!)}`
    : "";

  const designFields = hasWebsite
    ? `1. designQuality — how modern/professional the site looks based on HTML structure
2. contentQuality — is the copy professional, complete, and compelling?`
    : `1. designQuality — set to "poor" (no website exists)
2. contentQuality — set to "poor" (no website exists)`;

  const prompt = `You are a business analyst for a lead generation agency that builds websites for local businesses.

${searchStep}Analyze this local business and return ONLY valid JSON (no explanation, no markdown).

${contextLines}
${htmlSection}

Respond with JSON matching this exact schema:
{
  "designQuality": "poor" | "basic" | "decent" | "professional" | "excellent",
  "contentQuality": "poor" | "basic" | "decent" | "professional" | "excellent",
  "services": ["service1", "service2"],
  "uniqueSellingPoints": ["usp1", "usp2"],
  "painPoints": ["pain1", "pain2"],
  "outreachAngles": ["angle1", "angle2"],
  "summary": "One sentence summary of the business and its digital presence",
  "owner": {
    "ownerName": "Full Name" or null,
    "ownerEmail": "email@example.com" or null,
    "ownerPhone": "555-123-4567" or null,
    "ownerTitle": "Owner" or null
  }
}

Fields:
${designFields}
3. services — specific services this business provides, based on your web research and their category (3-5 items, be specific not generic)
4. uniqueSellingPoints — what makes them stand out based on what you found online (2-3 items)
5. painPoints — specific gaps in their digital presence you found (no website, outdated social pages, missing info, no online booking, etc.) (2-4 items)
6. outreachAngles — specific, personalized value propositions for why they need a professional website, referencing what you learned about them (2-3 items)
7. summary — one sentence about the business and its digital presence
8. owner — the business owner or primary contact person. Look for names on "About Us", "Our Team", "Contact" pages, in the website footer, in Google reviews owner responses, or from your web research. Include their title/role if found (e.g. "Owner", "Founder", "Manager", "DDS", "Dr."). Set fields to null if not found — do NOT guess or fabricate.

Keep arrays to 3-5 items max. Be specific and actionable, not generic. Reference real details you found about this specific business.`;

  console.log(`[ai-enrichment] Analyzing ${input.businessName} via Claude CLI (haiku)...`);
  const raw = await runClaude(prompt);
  const jsonStr = extractJson(raw);
  const parsed = JSON.parse(jsonStr) as AiEnrichmentResult;

  const owner: OwnerInfo = {
    ownerName: parsed.owner?.ownerName ?? null,
    ownerEmail: parsed.owner?.ownerEmail ?? null,
    ownerPhone: parsed.owner?.ownerPhone ?? null,
    ownerTitle: parsed.owner?.ownerTitle ?? null,
  };

  return {
    designQuality: parsed.designQuality,
    contentQuality: parsed.contentQuality,
    services: parsed.services ?? [],
    uniqueSellingPoints: parsed.uniqueSellingPoints ?? [],
    painPoints: parsed.painPoints ?? [],
    outreachAngles: parsed.outreachAngles ?? [],
    summary: parsed.summary ?? "",
    owner,
  };
}

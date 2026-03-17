import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_GEN_ROOT = join(__dirname, "..");

const CLI_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface ReviewInput {
  author: string;
  rating: number;
  text: string;
  date?: string;
  isLocalGuide?: boolean;
}

export interface PhotoInput {
  filename: string;
  publicUrl: string;
  sourceUrl: string;
  sizeBytes: number;
}

export interface BusinessInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  categories?: string[];
  googleRating?: number | null;
  reviewCount?: number | null;
  googleMapsUrl?: string | null;
  reviews?: ReviewInput[] | unknown;
  photos?: PhotoInput[] | unknown;
  aiInsights?: AiInsightsInput | null;
}

export interface AiInsightsInput {
  designQuality?: string;
  contentQuality?: string;
  services?: string[];
  uniqueSellingPoints?: string[];
  painPoints?: string[];
  outreachAngles?: string[];
  summary?: string;
}

/**
 * Run a prompt through the Claude Code CLI and return raw text output.
 * Spawns `claude -p` with `--dangerously-skip-permissions`.
 */
function runClaude(prompt: string): Promise<string> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      [
        "-p",
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
        "--model",
        "claude-sonnet-4-6",
        "--effort",
        "low",
      ],
      {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        cwd: PAGE_GEN_ROOT,
        env: { ...process.env, CLAUDECODE: "" },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[runClaude] CLI error:", error.message);
          if (stderr) console.error("[runClaude] stderr:", stderr);
          return reject(new Error(`Claude CLI failed: ${error.message}`));
        }

        const raw = stripAnsi(stdout).trim();
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

        // Parse JSON to extract usage stats and result text
        try {
          const parsed = JSON.parse(raw);

          if (parsed.usage) {
            console.log(
              `[runClaude] Token usage: input=${parsed.usage.input_tokens}, output=${parsed.usage.output_tokens}, cache_read=${parsed.usage.cache_read_input_tokens ?? 0}, cache_create=${parsed.usage.cache_creation_input_tokens ?? 0} | elapsed=${elapsedSec}s`,
            );
          }

          // Extract the text result from JSON response
          const text = parsed.result ?? parsed.text ?? parsed.content ?? "";
          resolve(typeof text === "string" ? text : JSON.stringify(text));
        } catch {
          // If JSON parsing fails, fall back to raw text
          console.warn(
            `[runClaude] Could not parse JSON output, falling back to raw text | elapsed=${elapsedSec}s`,
          );
          resolve(raw);
        }
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

/** Extract HTML from output — find <!DOCTYPE or <html to </html> */
function extractHtml(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:html)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.includes("<!DOCTYPE") || inner.includes("<html")) {
      return inner;
    }
  }

  // Find the HTML document in the output
  const docStart = raw.indexOf("<!DOCTYPE");
  const htmlStart = docStart !== -1 ? docStart : raw.indexOf("<html");
  if (htmlStart === -1) {
    // Log first 500 chars to help debug
    console.error(
      "[extractHtml] No HTML found. Output starts with:",
      raw.slice(0, 500),
    );
    throw new Error("No HTML document found in Claude output");
  }

  const htmlEnd = raw.lastIndexOf("</html>");
  if (htmlEnd === -1) {
    throw new Error("No closing </html> tag found in Claude output");
  }

  return raw.slice(htmlStart, htmlEnd + "</html>".length);
}

function formatReviews(reviews: unknown): string | null {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;

  const lines = reviews.map((r: ReviewInput, i: number) => {
    const guide = r.isLocalGuide ? " (Local Guide)" : "";
    return `  ${i + 1}. "${r.text}" — ${r.author}${guide}, ${r.rating}/5 stars`;
  });

  return `Real Google reviews (use these EXACTLY as testimonials on the page — do NOT make up fake reviews):\n${lines.join("\n")}`;
}

function formatPhotos(photos: unknown, categories: string[]): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;

  const categoryHint =
    categories.length > 0
      ? `This is a ${categories.join(" / ")} business.`
      : "";

  const photoLines = photos.map(
    (p: PhotoInput, i: number) => `  ${i + 1}. ${p.publicUrl}`,
  );

  return [
    `Real business photos (${photos.length} available):`,
    categoryHint,
    ...photoLines,
    "",
    "Image placement guidance:",
    "- Study the business categories and name to understand what these photos likely show (storefront, food, interior, team, work examples, etc.)",
    "- Use images where they reinforce the message — hero backgrounds, service showcases, gallery sections, testimonial backdrops",
    "- Apply appropriate CSS treatments: object-fit cover, rounded corners, overlays for text readability, aspect ratios that suit the content",
    "- Do NOT use every photo — pick the 3-5 that would have the strongest visual impact",
    '- Add descriptive alt text inferred from the business type (e.g., alt="Interior of [business name]" for a restaurant interior shot)',
  ].join("\n");
}

function formatAiInsights(
  insights: AiInsightsInput | null | undefined,
): string | null {
  if (!insights) return null;

  const lines: string[] = [];

  if (insights.services?.length) {
    lines.push(
      `Services this business offers: ${insights.services.join(", ")}`,
    );
  }
  if (insights.uniqueSellingPoints?.length) {
    lines.push(
      `What makes them stand out: ${insights.uniqueSellingPoints.join("; ")}`,
    );
  }
  if (insights.painPoints?.length) {
    lines.push(
      `Their digital presence gaps (use these to inform the page design — show them what they're missing): ${insights.painPoints.join("; ")}`,
    );
  }
  if (insights.outreachAngles?.length) {
    lines.push(
      `Key value propositions to emphasize on the page: ${insights.outreachAngles.join("; ")}`,
    );
  }
  if (insights.summary) {
    lines.push(`Business summary: ${insights.summary}`);
  }

  return lines.length > 0
    ? `\nAI-researched business insights (use these to personalize the page):\n${lines.join("\n")}`
    : null;
}

function buildBusinessContext(business: BusinessInput): string {
  const parts = [
    `Business name: ${business.name}`,
    business.phone && `Phone: ${business.phone}`,
    business.email && `Email: ${business.email}`,
    business.city &&
      business.state &&
      `Location: ${business.city}, ${business.state}`,
    business.address && `Address: ${business.address}`,
    business.categories?.length &&
      `Categories: ${business.categories.join(", ")}`,
    business.googleRating &&
      `Google rating: ${business.googleRating}/5 (${business.reviewCount ?? 0} reviews)`,
    business.googleMapsUrl && `Google Maps: ${business.googleMapsUrl}`,
    business.website && `Current website: ${business.website}`,
    formatReviews(business.reviews),
    formatPhotos(business.photos, business.categories ?? []),
    formatAiInsights(business.aiInsights),
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Generate a complete, styled HTML landing page for a business
 * using the Claude Code CLI in a single call.
 */
export async function generatePage(business: BusinessInput): Promise<string> {
  const businessContext = buildBusinessContext(business);

  const prompt = `Design and build a unique, high-converting landing page for this local business.

Business info:
${businessContext}

IMPORTANT: Before writing any code, think about what makes THIS business unique and what design approach would work best for THEIR customers. Choose a layout structure, color palette, typography, and section ordering that feels custom-made for this specific business — not a generic template. Different businesses should look completely different.

If real business photos are provided above, you MUST use them in the page. These are actual photos of the business from Google Maps — use them to make the page feel authentic and visually rich. See the image placement guidance above and the photo rules in your CLAUDE.md instructions.

Follow the technical requirements in your CLAUDE.md instructions.

CRITICAL: Print the COMPLETE HTML directly to stdout. Do NOT use any tools — no Write tool, no file creation, no code blocks. Just output raw HTML starting with <!DOCTYPE html> and ending with </html>. No commentary, no explanation, no markdown — ONLY the HTML.`;

  const MAX_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(
      `[ai-content] Generating full HTML page via Claude CLI (attempt ${attempt}/${MAX_RETRIES})...`,
    );
    const raw = await runClaude(prompt);

    try {
      const html = extractHtml(raw);
      console.log(`[ai-content] Page generated (${html.length} bytes)`);
      return html;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`[ai-content] Attempt ${attempt} failed, retrying...`);
    }
  }

  throw new Error("Unreachable");
}

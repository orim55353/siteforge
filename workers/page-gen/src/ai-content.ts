import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runClaude,
  extractHtml,
  buildBusinessContext,
} from "@lead-gen/ai";
import type { BusinessInput } from "@lead-gen/ai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_GEN_ROOT = join(__dirname, "..");

export type { BusinessInput };

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
    const raw = await runClaude(prompt, { cwd: PAGE_GEN_ROOT });

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

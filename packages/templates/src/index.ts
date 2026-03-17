import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "pages");

const templateCache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Load and compile a Handlebars template by ID.
 * Templates live in /packages/templates/pages/{templateId}.hbs
 */
export async function loadTemplate(
  templateId: string,
): Promise<HandlebarsTemplateDelegate> {
  const cached = templateCache.get(templateId);
  if (cached) return cached;

  const filePath = join(TEMPLATES_DIR, `${templateId}.hbs`);
  const source = await readFile(filePath, "utf-8");
  const compiled = Handlebars.compile(source);
  templateCache.set(templateId, compiled);
  return compiled;
}

/** Context shape that templates expect */
export interface TemplateContext {
  business: {
    name: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    googleRating?: number | null;
    reviewCount?: number | null;
    categories?: string[];
  };
  headline: HeadlineContent;
  services: ServicesContent;
  faq: FaqContent;
  seoMeta: SeoMetaContent;
}

export interface HeadlineContent {
  title: string;
  subtitle: string;
  ctaText: string;
}

export interface ServicesContent {
  intro: string;
  items: Array<{
    name: string;
    description: string;
  }>;
}

export interface FaqContent {
  items: Array<{
    question: string;
    answer: string;
  }>;
}

export interface SeoMetaContent {
  title: string;
  description: string;
  keywords: string[];
}

export { Handlebars };

export { injectClaimBar } from "./claim-bar.js";
export type { ClaimBarOptions } from "./claim-bar.js";

export { injectPageNav } from "./nav-injection.js";

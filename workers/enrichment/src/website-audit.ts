import * as cheerio from "cheerio";

export interface WebsiteAuditResult {
  loads: boolean;
  score: number;
  hasSsl: boolean;
  isMobileFriendly: boolean;
  hasOnlineBooking: boolean;
  techStack: string[];
  socialProfiles: Record<string, string>;
  html: string | null; // Raw HTML for downstream AI analysis
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch a website and run basic quality checks using Cheerio.
 * Returns a score 0-100 based on weighted signals.
 */
export async function auditWebsite(url: string): Promise<WebsiteAuditResult> {
  const empty: WebsiteAuditResult = {
    loads: false,
    score: 0,
    hasSsl: false,
    isMobileFriendly: false,
    hasOnlineBooking: false,
    techStack: [],
    socialProfiles: {},
    html: null,
  };

  // Normalize URL
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let html: string;
  let finalUrl: string;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadGenBot/1.0; +https://example.com)",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) return empty;

    finalUrl = response.url;
    html = await response.text();
  } catch {
    return empty;
  }

  const $ = cheerio.load(html);
  let score = 0;

  // ── 1. Page loads (20 pts) ──
  const loads = true;
  score += 20;

  // ── 2. SSL (15 pts) ──
  const hasSsl = finalUrl.startsWith("https://");
  if (hasSsl) score += 15;

  // ── 3. Has title tag (5 pts) ──
  const title = $("title").text().trim();
  if (title.length > 0) score += 5;

  // ── 4. Contact info present (15 pts) ──
  const bodyText = $("body").text();
  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(bodyText);
  const hasPhone = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.test(bodyText);
  const hasContactPage =
    $('a[href*="contact"]').length > 0 || $('a[href*="Contact"]').length > 0;
  if (hasEmail || hasPhone || hasContactPage) score += 15;

  // ── 5. Mobile responsive (15 pts) — viewport meta tag ──
  const viewportMeta = $('meta[name="viewport"]').attr("content") ?? "";
  const isMobileFriendly = viewportMeta.includes("width=");
  if (isMobileFriendly) score += 15;

  // ── 6. Has images (5 pts) ──
  if ($("img").length > 0) score += 5;

  // ── 7. Has structured content (10 pts) — headings ──
  if ($("h1, h2, h3").length > 0) score += 10;

  // ── 8. Online booking / scheduling (15 pts) ──
  const bookingKeywords = [
    "book online",
    "schedule appointment",
    "book now",
    "book appointment",
    "online booking",
    "schedule now",
    "request appointment",
  ];
  const lowerText = bodyText.toLowerCase();
  const hasOnlineBooking = bookingKeywords.some((kw) => lowerText.includes(kw));
  if (hasOnlineBooking) score += 15;

  // ── Tech stack detection ──
  const techStack: string[] = [];
  const htmlLower = html.toLowerCase();

  if (htmlLower.includes("wp-content") || htmlLower.includes("wordpress"))
    techStack.push("WordPress");
  if (htmlLower.includes("squarespace")) techStack.push("Squarespace");
  if (htmlLower.includes("wix.com") || htmlLower.includes("wixsite"))
    techStack.push("Wix");
  if (htmlLower.includes("shopify")) techStack.push("Shopify");
  if (htmlLower.includes("webflow")) techStack.push("Webflow");
  if (htmlLower.includes("godaddy")) techStack.push("GoDaddy");
  if (htmlLower.includes("react")) techStack.push("React");
  if (htmlLower.includes("next") && htmlLower.includes("_next"))
    techStack.push("Next.js");
  if ($('meta[name="generator"]').length > 0) {
    const generator = $('meta[name="generator"]').attr("content") ?? "";
    if (generator && !techStack.includes(generator)) techStack.push(generator);
  }

  // ── Social profiles ──
  const socialProfiles: Record<string, string> = {};
  const socialPatterns: [string, RegExp][] = [
    ["facebook", /https?:\/\/(www\.)?facebook\.com\/[^\s"']+/i],
    ["instagram", /https?:\/\/(www\.)?instagram\.com\/[^\s"']+/i],
    ["twitter", /https?:\/\/(www\.)?(twitter|x)\.com\/[^\s"']+/i],
    ["linkedin", /https?:\/\/(www\.)?linkedin\.com\/[^\s"']+/i],
    ["youtube", /https?:\/\/(www\.)?youtube\.com\/[^\s"']+/i],
    ["yelp", /https?:\/\/(www\.)?yelp\.com\/[^\s"']+/i],
  ];

  for (const [platform, pattern] of socialPatterns) {
    const match = html.match(pattern);
    if (match) socialProfiles[platform] = match[0];
  }

  // Cap at 100
  score = Math.min(score, 100);

  return {
    loads,
    score,
    hasSsl,
    isMobileFriendly,
    hasOnlineBooking,
    techStack,
    socialProfiles,
    html,
  };
}

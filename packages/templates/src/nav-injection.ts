/**
 * Navigation Injection
 *
 * Injects inter-page navigation links into an existing landing page's <nav>.
 * Used when extra pages (About, Services, Gallery) are generated for a business
 * that already has a deployed single-page landing page.
 */

interface NavPage {
  label: string;
  path: string;
}

const EXTRA_PAGES: NavPage[] = [
  { label: "About", path: "about" },
  { label: "Services", path: "services" },
  { label: "Gallery", path: "gallery" },
];

/**
 * Inject inter-page navigation links into an existing landing page HTML.
 *
 * Finds the desktop nav container (div with "hidden md:flex" or similar)
 * inside <nav> and inserts page links before the CTA button.
 *
 * @param html    - The full HTML of the landing page
 * @param slug    - The site slug (e.g. "joes-plumbing-austin-abc12345")
 * @param baseUrl - The base URL (e.g. "https://draft.siteforge.agency")
 * @returns The modified HTML with nav links injected
 */
export function injectPageNav(
  html: string,
  slug: string,
  baseUrl: string,
): string {
  // Strip any previously injected page nav links (idempotency)
  let cleaned = html;
  for (const page of EXTRA_PAGES) {
    const linkPattern = new RegExp(
      `\\s*<a\\s+href="${escapeRegex(baseUrl)}/${escapeRegex(slug)}/${escapeRegex(page.path)}/?"[^>]*>${page.label}</a>`,
      "g",
    );
    cleaned = cleaned.replace(linkPattern, "");
  }

  const navMatch = cleaned.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) {
    return injectStandaloneNav(cleaned, slug, baseUrl);
  }

  const navContent = navMatch[1];

  // Find section-anchor links (href="#...") to extract their classes
  const sectionLinkMatch = navContent.match(
    /<a\s+href="#[^"]*"\s+class="([^"]*)"[^>]*>/,
  );
  const linkClasses = sectionLinkMatch
    ? sectionLinkMatch[1]
    : "text-gray-300 hover:text-accent-400 transition-colors font-medium";

  // Build the new link HTML
  const newLinksHtml = EXTRA_PAGES.map(
    (page) =>
      `<a href="${baseUrl}/${slug}/${page.path}/" class="${linkClasses}">${page.label}</a>`,
  ).join("\n        ");

  let result = cleaned;

  // Find the CTA button (tel: link with bg- class) in the desktop nav
  // and insert page links before it
  const ctaMatch = navContent.match(
    /(<a\s+href="tel:[^"]*"[^>]*class="[^"]*bg-[^"]*"[^>]*>[\s\S]*?<\/a>)/,
  );

  if (ctaMatch) {
    // Find this CTA in the full HTML (use indexOf on the exact match)
    const ctaIdx = result.indexOf(ctaMatch[0]);
    if (ctaIdx !== -1) {
      result =
        result.slice(0, ctaIdx) +
        newLinksHtml +
        "\n        " +
        result.slice(ctaIdx);
    }
  } else {
    // Fallback: find the desktop nav container and append inside it
    const desktopNavMatch = navContent.match(
      /<div[^>]*class="[^"]*hidden[^"]*md:flex[^"]*"[^>]*>/,
    );
    if (desktopNavMatch) {
      const desktopNavStart = result.indexOf(desktopNavMatch[0]);
      if (desktopNavStart !== -1) {
        const afterDesktopNav = result.slice(desktopNavStart);
        const containerClose = findMatchingClose(afterDesktopNav);
        if (containerClose !== -1) {
          const insertPos = desktopNavStart + containerClose;
          result =
            result.slice(0, insertPos) +
            "\n        " +
            newLinksHtml +
            "\n      " +
            result.slice(insertPos);
        }
      }
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the position of the closing </div> that matches the opening <div> at position 0.
 */
function findMatchingClose(html: string): number {
  let depth = 0;
  let i = 0;

  while (i < html.length) {
    if (html.startsWith("<div", i)) {
      depth++;
      i = html.indexOf(">", i) + 1;
    } else if (html.startsWith("</div>", i)) {
      depth--;
      if (depth === 0) return i;
      i += 6;
    } else {
      i++;
    }
  }

  return -1;
}

function injectStandaloneNav(
  html: string,
  slug: string,
  baseUrl: string,
): string {
  const links = [
    { label: "Home", path: "" },
    ...EXTRA_PAGES,
  ];

  const linkHtml = links
    .map((page) => {
      const href = page.path
        ? `${baseUrl}/${slug}/${page.path}/`
        : `${baseUrl}/${slug}/`;
      return `<a href="${href}" class="text-gray-600 hover:text-gray-900 text-sm font-medium">${page.label}</a>`;
    })
    .join("\n      ");

  const navHtml = `
  <nav class="flex items-center gap-6 py-3 px-6 bg-white border-b">
    <div class="flex items-center gap-6">
      ${linkHtml}
    </div>
  </nav>`;

  const headerEnd = html.indexOf("</header>");
  if (headerEnd !== -1) {
    return html.slice(0, headerEnd) + navHtml + html.slice(headerEnd);
  }
  const bodyMatch = html.match(/(<body[^>]*>)/i);
  if (bodyMatch) {
    const insertPos = html.indexOf(bodyMatch[0]) + bodyMatch[0].length;
    return html.slice(0, insertPos) + "\n" + navHtml + html.slice(insertPos);
  }
  return html;
}

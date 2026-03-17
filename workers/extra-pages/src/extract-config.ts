/**
 * Extract and graft <head> from the landing page onto extra pages.
 *
 * Instead of asking Claude to replicate the Tailwind config, fonts, and CDN
 * scripts (which it does inconsistently), we extract the entire <head> from
 * the landing page and graft it onto Claude's output — keeping only the
 * sub-page's unique <title> and <meta> tags.
 */

export interface ExtractedHead {
  /** Everything inside <head>...</head> from the landing page */
  headContent: string;
}

/**
 * Extract the full <head> content from landing page HTML.
 */
export function extractHead(html: string): ExtractedHead {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) {
    throw new Error("No <head> found in landing page HTML");
  }

  return { headContent: headMatch[1] };
}

/**
 * Replace the <head> of a generated extra page with the landing page's <head>,
 * preserving only the extra page's <title> and <meta> description/OG tags.
 *
 * This guarantees identical fonts, Tailwind config, CDN scripts, and favicon
 * across all pages.
 */
export function graftHead(
  generatedHtml: string,
  landingHead: ExtractedHead,
): string {
  // Extract the generated page's unique meta tags
  const generatedHeadMatch = generatedHtml.match(
    /<head[^>]*>([\s\S]*?)<\/head>/i,
  );
  if (!generatedHeadMatch) return generatedHtml;

  const generatedHeadContent = generatedHeadMatch[1];

  // Pull out the page-specific tags from the generated page
  const titleMatch = generatedHeadContent.match(/<title>[^<]*<\/title>/i);
  const metaDescMatch = generatedHeadContent.match(
    /<meta\s+name="description"[^>]*>/i,
  );

  // Pull out all OG and Twitter meta tags from the generated page
  const ogTags: string[] = [];
  const ogRegex = /<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>/gi;
  let ogMatch;
  while ((ogMatch = ogRegex.exec(generatedHeadContent)) !== null) {
    ogTags.push(ogMatch[0]);
  }

  // Start with the landing page's head, then replace page-specific tags
  let newHead = landingHead.headContent;

  // Replace <title>
  if (titleMatch) {
    newHead = newHead.replace(/<title>[^<]*<\/title>/i, titleMatch[0]);
  }

  // Replace meta description
  if (metaDescMatch) {
    newHead = newHead.replace(
      /<meta\s+name="description"[^>]*>/i,
      metaDescMatch[0],
    );
  }

  // Replace OG/Twitter tags: remove landing page's OG tags, append generated page's
  newHead = newHead.replace(
    /<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\n?/gi,
    "",
  );
  if (ogTags.length > 0) {
    // Insert OG tags after the meta description
    const descIdx = newHead.search(/<meta\s+name="description"[^>]*>/i);
    if (descIdx !== -1) {
      const descEnd =
        descIdx + (newHead.slice(descIdx).match(/>/)?.index ?? 0) + 1;
      newHead =
        newHead.slice(0, descEnd) +
        "\n  " +
        ogTags.join("\n  ") +
        newHead.slice(descEnd);
    } else {
      // Append before closing
      newHead += "\n  " + ogTags.join("\n  ");
    }
  }

  // Replace the generated page's <head> with the grafted one
  return generatedHtml.replace(
    /<head[^>]*>[\s\S]*?<\/head>/i,
    `<head>\n${newHead}\n</head>`,
  );
}

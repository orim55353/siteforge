/**
 * Cloudflare Worker — serves landing pages and assets from R2 storage.
 *
 * Routes:
 *   GET /{slug}            → R2 key "{slug}/index.html"
 *   GET /{slug}/og.png     → dynamically generated OG image (cached at edge)
 *   GET /{slug}/hero.jpg   → R2 key "{slug}/hero.jpg"
 *
 * Tracks page views directly to Supabase (no external API needed).
 * Handles caching via ETag / If-None-Match.
 */

import { extractOgData, generateOgImage } from "./og-image.js";

interface Env {
  PAGES_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

interface CfProperties {
  country?: string;
  city?: string;
  region?: string;
  latitude?: string;
  longitude?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function getContentType(path: string): string {
  const ext = path.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function getCacheControl(contentType: string): string {
  if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
    return "public, max-age=86400, s-maxage=604800";
  }
  return "public, max-age=3600, s-maxage=86400";
}

function detectDevice(ua: string): string {
  const lower = ua.toLowerCase();
  if (/tablet|ipad/.test(lower)) return "tablet";
  if (/mobile|iphone|android(?!.*tablet)/.test(lower)) return "mobile";
  return "desktop";
}

async function hashVisitor(ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Insert a page_view row directly into Supabase via REST API. */
function trackView(
  request: Request,
  slug: string,
  env: Env,
  ctx: ExecutionContext,
): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;

  const cf = (request.cf ?? {}) as CfProperties;
  const ua = request.headers.get("User-Agent") ?? "";
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const referer = request.headers.get("Referer") ?? undefined;

  ctx.waitUntil(
    hashVisitor(ip, ua).then((visitorHash) =>
      fetch(`${env.SUPABASE_URL}/rest/v1/page_views`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          slug,
          country: cf.country ?? null,
          city: cf.city ?? null,
          region: cf.region ?? null,
          latitude: cf.latitude ? parseFloat(cf.latitude) : null,
          longitude: cf.longitude ? parseFloat(cf.longitude) : null,
          user_agent: ua || null,
          referer: referer ?? null,
          device_type: ua ? detectDevice(ua) : null,
          visitor_hash: visitorHash,
        }),
      }).catch(() => {
        // Analytics is best-effort — never block the page response
      }),
    ),
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    // Health check
    if (path === "_health") {
      return new Response("ok", { status: 200 });
    }

    // Root → redirect to main agency site
    if (!path) {
      return Response.redirect("https://siteforge.agency", 302);
    }

    // Dynamic OG image — /{slug}/og.png
    if (path.endsWith("/og.png") || path === "og.png") {
      const slug = path.replace(/\/?og\.png$/, "");
      if (!slug) return new Response("Not Found", { status: 404 });

      // Serve from CF edge cache if available
      const cache = caches.default;
      const cacheKey = new Request(url.toString());
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      // Read the page HTML to extract OG metadata
      const htmlObject = await env.PAGES_BUCKET.get(`${slug}/index.html`);
      if (!htmlObject) return new Response("Not Found", { status: 404 });

      const html = await htmlObject.text();
      const ogData = extractOgData(html);

      const png = await generateOgImage(ogData);

      const response = new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=604800, s-maxage=2592000",
        },
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // If path has no extension (page request, not asset), ensure trailing slash
    // so the browser resolves relative paths correctly (e.g. images/foo.jpg)
    const hasExtension = /\.[^/]+$/.test(path);
    if (!hasExtension && !url.pathname.endsWith("/")) {
      return Response.redirect(`${url.origin}/${path}/`, 301);
    }

    // Determine R2 key:
    //   /slug/         → slug/index.html  (page request)
    //   /slug/img.jpg  → slug/img.jpg     (asset request)
    const isPageRequest = !hasExtension;
    const key = isPageRequest ? `${path}/index.html` : path;

    const object = await env.PAGES_BUCKET.get(key);

    if (!object) {
      return new Response("Not Found", { status: 404 });
    }

    const isPreview = url.searchParams.get("preview") === "1";

    // Skip tracking for preview embeds
    if (isPageRequest && !isPreview) {
      const slug = path.split("/")[0];
      trackView(request, slug, env, ctx);
    }

    const contentType = getContentType(key);
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", getCacheControl(contentType));
    headers.set("X-Content-Type-Options", "nosniff");

    const etag = object.httpEtag;
    if (etag) {
      headers.set("ETag", etag);
    }

    // Conditional request support
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers });
    }

    // Allow the agency site to embed preview pages in iframes
    const origin = request.headers.get("Origin") ?? "";
    if (origin && (origin.endsWith("siteforge.agency") || origin.includes("localhost"))) {
      headers.set("Access-Control-Allow-Origin", origin);
    }

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    // In preview mode, strip the claim bar from HTML so the iframe shows a clean page
    if (isPageRequest && isPreview) {
      let html = await object.text();
      html = html.replace(
        /<!-- SiteForge Claim Bar -->[\s\S]*?<!-- \/SiteForge Claim Bar -->/,
        "",
      );
      // Remove body padding-top added for the claim bar
      html = html.replace(
        /(<body[^>]*style="[^"]*)padding-top:\s*\d+px;?\s*/i,
        "$1",
      );
      // Disable clicks inside the preview — redirect taps to the parent checkout page
      const previewInject =
        '<style>a,button,input,select,textarea,[onclick]{cursor:default!important;}</style>' +
        '<script>document.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();window.parent.postMessage({type:"sf-preview-click"},"*");},true);</script>';
      html = html.replace("</head>", previewInject + "</head>");
      // Allow the checkout page to embed this preview in an iframe
      headers.set(
        "Content-Security-Policy",
        "frame-ancestors https://siteforge.agency https://*.siteforge.agency http://localhost:*",
      );
      headers.delete("X-Frame-Options");
      return new Response(html, { status: 200, headers });
    }

    // Block framing of the live landing pages (clickjacking protection)
    if (isPageRequest) {
      headers.set("X-Frame-Options", "SAMEORIGIN");
      headers.set(
        "Content-Security-Policy",
        "frame-ancestors 'self'",
      );
    }

    return new Response(object.body, { status: 200, headers });
  },
} satisfies ExportedHandler<Env>;

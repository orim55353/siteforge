/**
 * Dynamic OG image generator.
 *
 * Renders a branded SiteForge card (1200x630 PNG) from the page's
 * title and description. Uses satori for SVG layout and resvg-wasm
 * for PNG conversion. Both the WASM binary and the Inter font are
 * fetched from CDN on first invocation, then kept in the isolate
 * for subsequent calls.
 */

import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const RESVG_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

// .woff (not woff2) — satori does not support woff2
const INTER_BOLD_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff";
const INTER_REGULAR_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff";

// ── Isolate-level caches (survive across requests in the same Worker isolate) ──

let wasmReady = false;
let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

// ── Public API ──

export interface OgData {
  title: string;
  description: string;
}

/** Extract og:title / og:description from the page HTML, with <title> / <meta name="description"> fallbacks. */
export function extractOgData(html: string): OgData {
  const titleMatch =
    html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i) ||
    html.match(/<title>([^<]*)<\/title>/i);

  const descMatch =
    html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i) ||
    html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);

  return {
    title: titleMatch ? decodeEntities(titleMatch[1]) : "Business Page",
    description: descMatch ? decodeEntities(descMatch[1]) : "",
  };
}

/** Generate a 1200x630 branded PNG card for the given OG data. */
export async function generateOgImage(data: OgData): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = await loadFonts();

  const svg = await satori(buildCard(data) as React.ReactNode, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: "Inter", data: fonts.regular, weight: 400 as const, style: "normal" as const },
      { name: "Inter", data: fonts.bold, weight: 700 as const, style: "normal" as const },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: OG_WIDTH },
  });
  return resvg.render().asPng();
}

// ── Internals ──

async function ensureWasm(): Promise<void> {
  if (wasmReady) return;
  await initWasm(fetch(RESVG_WASM_URL));
  wasmReady = true;
}

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontCache) return fontCache;

  const [regular, bold] = await Promise.all([
    fetch(INTER_REGULAR_URL).then((r) => r.arrayBuffer()),
    fetch(INTER_BOLD_URL).then((r) => r.arrayBuffer()),
  ]);

  fontCache = { regular, bold };
  return fontCache;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

/**
 * Build the satori element tree for the OG card.
 *
 * Layout (1200x630):
 *   - Amber accent bar at top
 *   - Business title (large, white, bold)
 *   - Description (medium, slate-400)
 *   - SiteForge branding at bottom
 */
function buildCard(data: OgData): unknown {
  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 70px",
        background:
          "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        fontFamily: "Inter",
        color: "white",
      },
      children: [
        // Top accent line
        {
          type: "div",
          props: {
            style: {
              width: "80px",
              height: "5px",
              borderRadius: "3px",
              background: "#F59E0B",
            },
          },
        },

        // Title + description
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "54px",
                    fontWeight: 700,
                    lineHeight: 1.15,
                    letterSpacing: "-0.02em",
                  },
                  children: truncate(data.title, 80),
                },
              },
              data.description
                ? {
                    type: "div",
                    props: {
                      style: {
                        fontSize: "24px",
                        fontWeight: 400,
                        color: "#94a3b8",
                        lineHeight: 1.5,
                      },
                      children: truncate(data.description, 140),
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },

        // Bottom branding
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "12px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    background: "#F59E0B",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#0f172a",
                  },
                  children: "SF",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "18px",
                    fontWeight: 600,
                    color: "#94a3b8",
                  },
                  children: "siteforge.agency",
                },
              },
            ],
          },
        },
      ],
    },
  };
}

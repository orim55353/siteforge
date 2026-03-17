/**
 * Claim Bar Injector
 *
 * Injects a sticky "Claim This Website" bar at the top of generated
 * landing pages. The bar links prospects to a checkout page where they
 * can claim the site built for their business.
 *
 * The injected block is fully self-contained (CSS + HTML + JS) and does
 * not depend on Tailwind or any external stylesheet.
 */

export interface ClaimBarOptions {
  slug: string;
  businessName: string;
  checkoutBaseUrl: string; // e.g. "https://siteforge.agency/checkout"
  barMessage?: string;
  ctaText?: string;
}

const DEFAULT_BAR_MESSAGE =
  "We built this page for your business. It's yours if you want it.";
const DEFAULT_CTA_TEXT = "Claim This Site";

const BAR_HEIGHT_DESKTOP = 48;
const BAR_HEIGHT_MOBILE = 44;

function buildCheckoutUrl(
  baseUrl: string,
  slug: string,
  businessName: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("slug", slug);
  url.searchParams.set("business", businessName);
  return url.toString();
}

function buildClaimBarCss(): string {
  return `
<style>
  .pr-claim-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: ${BAR_HEIGHT_DESKTOP}px;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--pr-bar-bg, linear-gradient(135deg, #0f172a 0%, #1e293b 100%));
    color: var(--pr-bar-text, #f8fafc);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    animation: pr-claim-bar-slide 0.4s ease-out;
    box-sizing: border-box;
  }

  @keyframes pr-claim-bar-slide {
    from { transform: translateY(-100%); }
    to   { transform: translateY(0); }
  }

  .pr-claim-bar__left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .pr-claim-bar__logo {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
  }

  .pr-claim-bar__message {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pr-claim-bar__right {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-left: 12px;
  }

  .pr-claim-bar__cta {
    display: inline-block;
    padding: 8px 20px;
    background: var(--pr-cta-bg, linear-gradient(135deg, #f59e0b 0%, #f97316 100%));
    color: var(--pr-cta-text, #fff);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.3px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 0 8px var(--pr-cta-glow, rgba(245, 158, 11, 0.25));
    animation: pr-cta-pulse 3s ease-in-out infinite;
  }

  .pr-claim-bar__cta:hover {
    transform: scale(1.04);
    box-shadow: 0 0 14px var(--pr-cta-glow, rgba(245, 158, 11, 0.4));
  }

  @keyframes pr-cta-pulse {
    0%, 100% { box-shadow: 0 0 8px var(--pr-cta-glow, rgba(245, 158, 11, 0.25)); }
    50% { box-shadow: 0 0 14px var(--pr-cta-glow, rgba(245, 158, 11, 0.4)); }
  }

  .pr-claim-bar__shimmer {
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
    animation: pr-shimmer 3s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes pr-shimmer {
    0% { left: -100%; }
    100% { left: 100%; }
  }

  @media (max-width: 640px) {
    .pr-claim-bar {
      height: ${BAR_HEIGHT_MOBILE}px;
      padding: 0 10px;
      font-size: 12px;
    }

    .pr-claim-bar__message--full {
      display: none;
    }

    .pr-claim-bar__message--short {
      display: inline;
    }

    .pr-claim-bar__cta {
      font-size: 12px;
      padding: 6px 14px;
    }
  }

  @media (min-width: 641px) {
    .pr-claim-bar__message--short {
      display: none;
    }

    .pr-claim-bar__message--full {
      display: inline;
    }
  }

  /* ---- Bottom Claim Banner (cookie-consent style) ---- */
  .pr-claim-bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9998;
    background: var(--pr-bar-bg, linear-gradient(135deg, #0f172a 0%, #1e293b 100%));
    color: var(--pr-bar-text, #f8fafc);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.25);
    transform: translateY(100%);
    animation: pr-bottom-slide 0.5s ease-out 5s forwards;
    box-sizing: border-box;
  }

  @keyframes pr-bottom-slide {
    to { transform: translateY(0); }
  }

  .pr-claim-bottom__inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 20px 24px;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .pr-claim-bottom__logo {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
  }

  .pr-claim-bottom__content {
    flex: 1;
    min-width: 0;
  }

  .pr-claim-bottom__title {
    font-size: 15px;
    font-weight: 700;
    margin: 0 0 4px;
    line-height: 1.3;
  }

  .pr-claim-bottom__desc {
    font-size: 13px;
    opacity: 0.85;
    margin: 0;
    line-height: 1.4;
  }

  .pr-claim-bottom__actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .pr-claim-bottom__cta {
    display: inline-block;
    padding: 10px 24px;
    background: var(--pr-cta-bg, linear-gradient(135deg, #f59e0b 0%, #f97316 100%));
    color: var(--pr-cta-text, #fff);
    font-size: 14px;
    font-weight: 700;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 2px 12px var(--pr-cta-glow, rgba(245, 158, 11, 0.3));
  }

  .pr-claim-bottom__cta:hover {
    transform: scale(1.03);
    box-shadow: 0 4px 18px var(--pr-cta-glow, rgba(245, 158, 11, 0.45));
  }

  @media (max-width: 640px) {
    .pr-claim-bottom__inner {
      flex-direction: column;
      text-align: center;
      padding: 16px 16px;
      gap: 12px;
    }

    .pr-claim-bottom__logo {
      display: none;
    }

    .pr-claim-bottom__actions {
      width: 100%;
      justify-content: center;
    }

    .pr-claim-bottom__cta {
      flex: 1;
    }
  }

  /* ---- Claim Modal ---- */
  .pr-claim-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    animation: pr-modal-fade-in 0.3s ease forwards;
  }

  @keyframes pr-modal-fade-in {
    to { opacity: 1; }
  }

  .pr-claim-modal-overlay--closing {
    animation: pr-modal-fade-out 0.25s ease forwards;
  }

  @keyframes pr-modal-fade-out {
    to { opacity: 0; }
  }

  .pr-claim-modal {
    background: #fff;
    border-radius: 16px;
    padding: 36px 32px 28px;
    max-width: 420px;
    width: 90%;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    transform: scale(0.9) translateY(20px);
    animation: pr-modal-pop 0.3s ease forwards;
    position: relative;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  @keyframes pr-modal-pop {
    to { transform: scale(1) translateY(0); }
  }

  .pr-claim-modal__close {
    position: absolute;
    top: 12px;
    right: 14px;
    background: none;
    border: none;
    font-size: 22px;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    transition: color 0.15s ease;
  }

  .pr-claim-modal__close:hover {
    color: #334155;
  }

  .pr-claim-modal__badge {
    display: inline-block;
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    color: #92400e;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    padding: 4px 12px;
    border-radius: 20px;
    margin-bottom: 16px;
  }

  .pr-claim-modal__title {
    font-size: 22px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 8px;
    line-height: 1.3;
  }

  .pr-claim-modal__desc {
    font-size: 14px;
    color: #64748b;
    margin: 0 0 24px;
    line-height: 1.5;
  }

  .pr-claim-modal__cta,
  .pr-claim-modal__cta:link,
  .pr-claim-modal__cta:visited {
    display: inline-block !important;
    width: 100% !important;
    padding: 14px 32px !important;
    background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%) !important;
    color: #fff !important;
    font-size: 16px !important;
    font-weight: 700 !important;
    border: none !important;
    border-radius: 10px !important;
    cursor: pointer !important;
    text-decoration: none !important;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 4px 16px rgba(245, 158, 11, 0.35) !important;
  }

  .pr-claim-modal__cta:hover {
    transform: scale(1.03);
    color: #fff !important;
    box-shadow: 0 6px 24px rgba(245, 158, 11, 0.5) !important;
  }

  .pr-claim-modal__note {
    font-size: 12px;
    color: #94a3b8;
    margin: 12px 0 0;
  }

  @media (max-width: 640px) {
    .pr-claim-modal {
      padding: 28px 20px 22px;
    }

    .pr-claim-modal__title {
      font-size: 18px;
    }

    .pr-claim-modal__cta {
      padding: 12px 24px;
      font-size: 15px;
    }
  }

</style>`;
}

function buildLogoSvg(): string {
  return `<svg class="pr-claim-bar__logo" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="28" height="28" rx="7" fill="#0f172a"/>
  <rect x="7.5" y="8" width="13" height="7" rx="2" fill="#F59E0B"/>
  <rect x="12" y="14" width="3" height="10" rx="1.5" fill="white"/>
  <circle cx="23" cy="10" r="1.4" fill="white" opacity="0.6"/>
</svg>`;
}

function buildClaimBarHtml(
  checkoutUrl: string,
  message: string,
  ctaText: string,
): string {
  const escapedMessage = escapeHtml(message);
  const escapedCta = escapeHtml(ctaText);

  return `
<div class="pr-claim-bar" id="pr-claim-bar">
  <div class="pr-claim-bar__left">
    ${buildLogoSvg()}
    <span class="pr-claim-bar__message">
      <span class="pr-claim-bar__message--full">${escapedMessage}</span>
      <span class="pr-claim-bar__message--short">This page is yours if you want it.</span>
    </span>
  </div>
  <div class="pr-claim-bar__right">
    <a class="pr-claim-bar__cta" href="${escapeHtml(checkoutUrl)}">${escapedCta} &rarr;</a>
  </div>
  <div class="pr-claim-bar__shimmer"></div>
</div>`;
}

function buildClaimBottomBannerHtml(
  checkoutUrl: string,
  businessName: string,
): string {
  const escaped = escapeHtml(businessName);

  return `
<div class="pr-claim-bottom" id="pr-claim-bottom">
  <div class="pr-claim-bottom__inner">
    ${buildLogoSvg().replace('pr-claim-bar__logo', 'pr-claim-bottom__logo')}
    <div class="pr-claim-bottom__content">
      <p class="pr-claim-bottom__title">This website was built for ${escaped}</p>
      <p class="pr-claim-bottom__desc">We designed this page specifically for your business. Claim it and go live today.</p>
    </div>
    <div class="pr-claim-bottom__actions">
      <a class="pr-claim-bottom__cta" href="${escapeHtml(checkoutUrl)}">Claim Your Site &rarr;</a>
    </div>
  </div>
</div>`;
}

function buildClaimModalHtml(
  checkoutUrl: string,
  businessName: string,
): string {
  const escaped = escapeHtml(businessName);

  return `
<div class="pr-claim-modal-overlay" id="pr-claim-modal" style="display:none;">
  <div class="pr-claim-modal">
    <button class="pr-claim-modal__close" id="pr-claim-modal-close" aria-label="Close">&times;</button>
    <div class="pr-claim-modal__badge">Limited-time offer</div>
    <h2 class="pr-claim-modal__title">This website was built for ${escaped}</h2>
    <p class="pr-claim-modal__desc">We created this page specifically for your business. Claim it now and go live today — no design or tech skills needed.</p>
    <a class="pr-claim-modal__cta" href="${escapeHtml(checkoutUrl)}">Claim Your Website &rarr;</a>
    <p class="pr-claim-modal__note">No commitment required. Cancel anytime.</p>
  </div>
</div>`;
}

function buildClaimBarScript(): string {
  return `
<script>
(function() {
  var BAR_H = ${BAR_HEIGHT_DESKTOP};
  var bar = document.getElementById('pr-claim-bar');
  if (!bar) return;

  // Hide claim bar in preview mode (e.g. checkout page iframe)
  if (new URLSearchParams(window.location.search).get('preview') === '1') {
    bar.style.display = 'none';
    var bottom = document.getElementById('pr-claim-bottom');
    if (bottom) bottom.style.display = 'none';
    document.body.style.paddingTop = '0px';
    return;
  }

  // ---- Adaptive Color Contrast ----
  // Samples the page's dominant colors and picks bar/CTA colors that pop
  function samplePageColors() {
    var samples = [];
    var targets = document.querySelectorAll('body, header, nav, main, section, .hero, [class*="hero"], [class*="banner"]');
    for (var i = 0; i < targets.length && i < 15; i++) {
      var s = getComputedStyle(targets[i]);
      if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
        samples.push(s.backgroundColor);
      }
    }
    return samples;
  }

  function parseRgb(str) {
    var m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s, l: l };
  }

  function luminance(r, g, b) {
    var a = [r, g, b].map(function(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  // Contrast-popping color palettes to choose from
  var POP_PALETTES = [
    { bar: '#e11d48', barEnd: '#be123c', cta: '#fbbf24', ctaEnd: '#f59e0b', glow: 'rgba(251,191,36,0.35)', text: '#fff', ctaText: '#1c1917' },  // rose + gold
    { bar: '#7c3aed', barEnd: '#6d28d9', cta: '#34d399', ctaEnd: '#10b981', glow: 'rgba(52,211,153,0.35)', text: '#fff', ctaText: '#fff' },      // purple + emerald
    { bar: '#0891b2', barEnd: '#0e7490', cta: '#fbbf24', ctaEnd: '#f59e0b', glow: 'rgba(251,191,36,0.35)', text: '#fff', ctaText: '#1c1917' },    // cyan + gold
    { bar: '#dc2626', barEnd: '#b91c1c', cta: '#fff', ctaEnd: '#f1f5f9', glow: 'rgba(255,255,255,0.2)', text: '#fff', ctaText: '#dc2626' },       // red + white
    { bar: '#1d4ed8', barEnd: '#1e40af', cta: '#fbbf24', ctaEnd: '#f59e0b', glow: 'rgba(251,191,36,0.35)', text: '#fff', ctaText: '#1c1917' },    // blue + gold
    { bar: '#0f172a', barEnd: '#1e293b', cta: '#22d3ee', ctaEnd: '#06b6d4', glow: 'rgba(34,211,238,0.35)', text: '#f8fafc', ctaText: '#0f172a' }, // dark + cyan
    { bar: '#15803d', barEnd: '#166534', cta: '#fbbf24', ctaEnd: '#f59e0b', glow: 'rgba(251,191,36,0.35)', text: '#fff', ctaText: '#1c1917' },    // green + gold
    { bar: '#ea580c', barEnd: '#c2410c', cta: '#fff', ctaEnd: '#f1f5f9', glow: 'rgba(255,255,255,0.2)', text: '#fff', ctaText: '#ea580c' },       // orange + white
  ];

  function pickContrastPalette(pageSamples) {
    var pageHues = [];
    var avgLum = 0.5;
    var count = 0;

    for (var i = 0; i < pageSamples.length; i++) {
      var rgb = parseRgb(pageSamples[i]);
      if (!rgb) continue;
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      pageHues.push(hsl.h);
      avgLum += luminance(rgb.r, rgb.g, rgb.b);
      count++;
    }
    if (count > 0) avgLum /= count;

    // For each palette, score how different its hue is from page hues
    var bestIdx = 0;
    var bestScore = -1;

    for (var p = 0; p < POP_PALETTES.length; p++) {
      var pal = POP_PALETTES[p];
      var barRgb = hexToRgb(pal.bar);
      var barHsl = rgbToHsl(barRgb.r, barRgb.g, barRgb.b);
      var barLum = luminance(barRgb.r, barRgb.g, barRgb.b);

      // Hue distance from all page hues
      var hueScore = 0;
      for (var h = 0; h < pageHues.length; h++) {
        var diff = Math.abs(barHsl.h - pageHues[h]);
        if (diff > 180) diff = 360 - diff;
        hueScore += diff;
      }
      hueScore = pageHues.length > 0 ? hueScore / pageHues.length : 90;

      // Luminance contrast bonus
      var lumContrast = Math.abs(barLum - avgLum);

      var score = hueScore * 0.7 + lumContrast * 100 * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = p;
      }
    }

    return POP_PALETTES[bestIdx];
  }

  function hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return { r: r, g: g, b: b };
  }

  function applyPalette(palette) {
    var root = document.documentElement;
    root.style.setProperty('--pr-bar-bg', 'linear-gradient(135deg, ' + palette.bar + ' 0%, ' + palette.barEnd + ' 100%)');
    root.style.setProperty('--pr-bar-text', palette.text);
    root.style.setProperty('--pr-cta-bg', 'linear-gradient(135deg, ' + palette.cta + ' 0%, ' + palette.ctaEnd + ' 100%)');
    root.style.setProperty('--pr-cta-text', palette.ctaText);
    root.style.setProperty('--pr-cta-glow', palette.glow);

    // Update logo SVG background to match bar
    var logoRect = bar.querySelector('.pr-claim-bar__logo rect:first-child');
    if (logoRect) logoRect.setAttribute('fill', palette.bar);
    var logoAccent = bar.querySelector('.pr-claim-bar__logo rect:nth-child(2)');
    if (logoAccent) logoAccent.setAttribute('fill', palette.cta);
  }

  function initAdaptiveColors() {
    var samples = samplePageColors();
    if (samples.length === 0) return; // keep defaults
    var palette = pickContrastPalette(samples);
    applyPalette(palette);
  }

  // Run color adaptation after page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdaptiveColors);
  } else {
    initAdaptiveColors();
  }

  // Push down any fixed/sticky elements at top:0 so they sit below the claim bar
  function offsetFixedElements(offset) {
    var els = document.querySelectorAll('nav, header, [class*="fixed"], [class*="sticky"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === bar || el.closest('#pr-claim-bar') || el.closest('#pr-claim-bottom')) continue;
      var style = getComputedStyle(el);
      var pos = style.position;
      if (pos === 'fixed' || pos === 'sticky') {
        var top = parseInt(style.top, 10);
        if (top === 0 || (isNaN(top) && style.top === 'auto')) {
          el.style.top = offset + 'px';
          el.setAttribute('data-pr-offset', '1');
        }
      }
    }
  }

  // Apply offset once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { offsetFixedElements(BAR_H); });
  } else {
    offsetFixedElements(BAR_H);
  }

  // ---- Claim Modal (30s delay, closable, reappears on refresh) ----
  var modalDismissed = false;
  var modal = document.getElementById('pr-claim-modal');
  var modalClose = document.getElementById('pr-claim-modal-close');

  if (modal && modalClose) {
    setTimeout(function() {
      if (modalDismissed) return;
      modal.style.display = 'flex';
    }, 30000);

    function dismissModal() {
      modalDismissed = true;
      modal.classList.add('pr-claim-modal-overlay--closing');
      setTimeout(function() { modal.style.display = 'none'; }, 250);
    }

    modalClose.addEventListener('click', dismissModal);

    modal.addEventListener('click', function(e) {
      if (e.target === modal) dismissModal();
    });
  }
})();
</script>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Height of the bottom claim banner (approximate, matches CSS padding). */
const BOTTOM_BANNER_HEIGHT = 80;

/**
 * Add padding-top and padding-bottom to the <body> tag so page content sits
 * below the top bar and above the bottom banner.
 *
 * If the body tag already has an inline style with padding-top/bottom, the
 * values are incremented rather than replaced.
 */
function addBodyPadding(html: string): string {
  const bodyTagRegex = /(<body)([^>]*)(>)/i;
  const match = html.match(bodyTagRegex);

  if (!match) return html;

  const [fullMatch, openTag, attrs, closeBracket] = match;

  // Check for existing inline style
  const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);

  if (styleMatch) {
    let existingStyle = styleMatch[1];

    // Handle padding-top
    const paddingTopMatch = existingStyle.match(/padding-top\s*:\s*(\d+)/);
    if (paddingTopMatch) {
      const existingPadding = parseInt(paddingTopMatch[1], 10);
      const newPadding = existingPadding + BAR_HEIGHT_DESKTOP;
      existingStyle = existingStyle.replace(
        /padding-top\s*:\s*\d+px/,
        `padding-top: ${newPadding}px`,
      );
    } else {
      existingStyle = `padding-top: ${BAR_HEIGHT_DESKTOP}px; ${existingStyle}`;
    }

    // Handle padding-bottom
    const paddingBottomMatch = existingStyle.match(/padding-bottom\s*:\s*(\d+)/);
    if (paddingBottomMatch) {
      const existingPadding = parseInt(paddingBottomMatch[1], 10);
      const newPadding = existingPadding + BOTTOM_BANNER_HEIGHT;
      existingStyle = existingStyle.replace(
        /padding-bottom\s*:\s*\d+px/,
        `padding-bottom: ${newPadding}px`,
      );
    } else {
      existingStyle = `${existingStyle} padding-bottom: ${BOTTOM_BANNER_HEIGHT}px;`;
    }

    const newAttrs = attrs.replace(
      /style\s*=\s*"[^"]*"/i,
      `style="${existingStyle}"`,
    );
    return html.replace(fullMatch, `${openTag}${newAttrs}${closeBracket}`);
  }

  // No inline style at all
  return html.replace(
    fullMatch,
    `${openTag}${attrs} style="padding-top: ${BAR_HEIGHT_DESKTOP}px; padding-bottom: ${BOTTOM_BANNER_HEIGHT}px;"${closeBracket}`,
  );
}

/**
 * Adjust any existing scroll-padding-top on <html> by adding the bar height.
 */
function adjustScrollPadding(html: string): string {
  const scrollPaddingRegex = /scroll-padding-top\s*:\s*(\d+)px/g;

  return html.replace(scrollPaddingRegex, (_match, value) => {
    const adjusted = parseInt(value, 10) + BAR_HEIGHT_DESKTOP;
    return `scroll-padding-top: ${adjusted}px`;
  });
}

/**
 * Inject a sticky "Claim This Website" bar into the HTML of a landing page.
 *
 * The bar is a self-contained block (CSS + HTML + JS) inserted right after
 * the opening <body> tag. Body padding is adjusted so existing content is
 * pushed down below the bar.
 */
export function injectClaimBar(html: string, options: ClaimBarOptions): string {
  const {
    slug,
    businessName,
    checkoutBaseUrl,
    barMessage = DEFAULT_BAR_MESSAGE,
    ctaText = DEFAULT_CTA_TEXT,
  } = options;

  const checkoutUrl = buildCheckoutUrl(checkoutBaseUrl, slug, businessName);

  const injectedBlock = [
    "<!-- SiteForge Claim Bar -->",
    buildClaimBarCss(),
    buildClaimBarHtml(checkoutUrl, barMessage, ctaText),
    buildClaimBottomBannerHtml(checkoutUrl, businessName),
    buildClaimModalHtml(checkoutUrl, businessName),
    buildClaimBarScript(),
    "<!-- /SiteForge Claim Bar -->",
  ].join("\n");

  // Inject after <body...>
  const bodyOpenRegex = /(<body[^>]*>)/i;
  let result = html.replace(bodyOpenRegex, `$1\n${injectedBlock}`);

  // Adjust body padding and scroll-padding-top
  result = addBodyPadding(result);
  result = adjustScrollPadding(result);

  return result;
}

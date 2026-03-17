/**
 * Prompt builders for extra page types (About, Services, Gallery).
 *
 * Each prompt instructs Claude to generate a full HTML page. The <head> will
 * be replaced programmatically with the landing page's <head> after generation,
 * so we don't need Claude to replicate the exact Tailwind config or fonts.
 * We just need it to use the correct Tailwind class names (primary-*, accent-*,
 * font-display, font-sans).
 */

interface PromptInput {
  businessContext: string;
  slug: string;
  baseUrl: string;
}

function buildSharedInstructions(input: PromptInput, pageType: string): string {
  const { slug, baseUrl } = input;

  return `
VISUAL IDENTITY:
The <head> of this page (fonts, Tailwind config, CDN scripts) will be replaced programmatically
to match the existing landing page. You do NOT need to worry about getting the exact config right.
Just include a basic <head> with <title> and <meta> tags.

However, you MUST use these Tailwind class names for colors and fonts (they map to the landing page's palette):
- Colors: primary-50 through primary-950 (blues/darks), accent-50 through accent-950 (oranges)
- Fonts: font-display for headings (maps to a display font), font-sans for body text
- Use bg-primary-700 for dark nav/header backgrounds
- Use text-accent-400 / bg-accent-500 for CTA buttons and highlights
- Use bg-white and text-gray-800 for main content areas

NAVIGATION — REQUIRED:
Include a sticky top navigation bar with these links:
- Home: ${baseUrl}/${slug}/
- About: ${baseUrl}/${slug}/about/
- Services: ${baseUrl}/${slug}/services/
- Gallery: ${baseUrl}/${slug}/gallery/

Style the nav with bg-primary-700, and use text-gray-300 hover:text-accent-400 for links.
Highlight the "${pageType}" link as the active page (use text-white font-semibold or border-b-2 border-accent-400).

TECHNICAL REQUIREMENTS:
- Include <script src="https://cdn.tailwindcss.com"></script> in <head>
- Include <script src="https://unpkg.com/lucide@latest"></script> in <head>
- Use Lucide icons via <i data-lucide="icon-name" class="..."></i>
- Call lucide.createIcons() in a <script> before </body>
- NEVER use emojis anywhere
- NEVER use em dashes
- Mobile-first responsive design
- Include proper <title> and <meta name="description"> tags
- Include Open Graph meta tags with %%PAGE_URL%% placeholder
- Include the analytics tracking snippet before </body>:
<script>
(function() {
  var slug = location.pathname.replace(/^\\/|\\/$/g, '') || '';
  if (!slug) return;
  var ua = navigator.userAgent;
  var w = window.innerWidth;
  var device = w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
  var hash = 0;
  var raw = ua + (navigator.language || '');
  for (var i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
  var visitorHash = Math.abs(hash).toString(36);
  fetch('%%TRACKING_URL%%', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: slug,
      userAgent: ua,
      referer: document.referrer || null,
      deviceType: device,
      visitorHash: visitorHash
    })
  }).catch(function() {});
})();
</script>

WRITING STYLE:
- Sound like a real person, not AI
- Never use promotional adjectives (stunning, beautiful, breathtaking, etc.)
- Never use AI filler words (additionally, furthermore, leverage, etc.)
- Match the business's voice and industry tone
- Be specific, not vague

OUTPUT:
Print ONLY the complete HTML. Start with <!DOCTYPE html>, end with </html>.
No commentary, no explanation, no markdown fences.`;
}

export function buildAboutPrompt(input: PromptInput): string {
  return `Build an "About" page for this local business.

Business info:
${input.businessContext}

PAGE PURPOSE:
This is the About page. Tell the business's story in a way that builds trust with local customers.

CONTENT GUIDANCE:
- Lead with what the business does and who they serve (local customers, not investors)
- If reviews mention specific people, team members, or personal touches, weave those in
- Include a "Our Values" or "What We Stand For" section if the business has clear differentiators
- Add a community/local connection section ("Proudly serving [city] since...")
- If the business has a Google rating, feature it as a trust signal
- Include a clear CTA at the bottom (call to action to contact or visit)
- Every phone number must be a clickable tel: link
- Every email must be a clickable mailto: link

LAYOUT:
- Hero with business name and a brief tagline
- Story/history section
- Values or differentiators (2-3 items, use Lucide icons)
- Team or community section
- CTA section with contact info

${buildSharedInstructions(input, "About")}`;
}

export function buildServicesPrompt(input: PromptInput): string {
  return `Build a "Services" page for this local business.

Business info:
${input.businessContext}

PAGE PURPOSE:
This is the Services page. Give potential customers a clear, detailed view of what this business offers.

CONTENT GUIDANCE:
- Use the aiInsights.services list to structure the services breakdown
- For each service, write a short description (2-3 sentences) that explains what the customer gets
- If no specific services are listed, infer them from the business categories and reviews
- Include a "How It Works" or "Our Process" section (3-4 steps) if the business is a service provider
- Add pricing context if available (e.g. "Free estimates", "Call for a quote")
- End with a strong CTA to contact the business
- Every phone number must be a clickable tel: link
- Every email must be a clickable mailto: link

LAYOUT:
- Hero with "Our Services" headline
- Services grid or list (each service gets a card with Lucide icon, name, description)
- Process/How It Works section (numbered steps)
- FAQ section (3-4 questions relevant to this business's services)
- CTA section with contact info

${buildSharedInstructions(input, "Services")}`;
}

export function buildGalleryPrompt(input: PromptInput): string {
  return `Build a "Gallery" page for this local business.

Business info:
${input.businessContext}

PAGE PURPOSE:
This is the Gallery page. Showcase the business visually with a photo-forward layout.

CONTENT GUIDANCE:
- This page should be primarily visual with minimal text
- Use ALL available business photos (unlike the landing page which picks 3-5)
- If photos are provided, create a responsive masonry or grid layout
- Add descriptive captions inferred from the business type
- If NO photos are provided, create a visual page using the business's color palette:
  - Large typography showcasing the business name
  - Icon-based service highlights
  - A "Photos coming soon" section with a CTA to contact
- Include a CTA to contact the business or visit the main page
- Every phone number must be a clickable tel: link

LAYOUT:
- Hero with "Gallery" headline and brief intro
- Photo grid (responsive: 1 col mobile, 2 cols tablet, 3 cols desktop)
- Each photo should have: rounded corners, hover effect (slight scale), object-fit cover
- Optional: category filters if photos span different types of work
- CTA section at bottom

PHOTO CSS:
- Use aspect-square or aspect-video depending on the photo
- object-fit: cover on all images
- rounded-lg or rounded-xl
- shadow-md on hover
- Lightbox effect is NOT needed (keep it simple)

${buildSharedInstructions(input, "Gallery")}`;
}

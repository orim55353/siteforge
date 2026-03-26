# Lead Gen Platform — Claude Code Context

## What we're building

An AI-assisted lead generation platform that:

1. Discovers local businesses (Google Places / SerpAPI)
2. Enriches and scores them (website quality, ratings, review count)
3. Generates personalized landing pages using AI content + Handlebars templates
4. Sends timezone-aware outreach emails with a preview page link
5. Ingests replies and forwards them to the founder
6. Tracks everything in a CRM pipeline

## Tech Stack

- Database: Supabase (Postgres via Prisma ORM)
- Serverless: GCP Cloud Functions gen2 (scales to zero, $0/mo on free tier)
- Scheduler: GCP Cloud Scheduler (hourly email sends)
- Email: Resend (outbound + inbound webhooks)
- File Storage: Cloudflare R2 (landing page HTML + assets)
- Landing Page Serving: Cloudflare Worker (`lead-pages-router`) reading from R2
- Agency Site Hosting: Cloudflare Pages (static HTML — `siteforge.agency`)
- AI: Claude API (claude-haiku-3 for page content generation)
- Backend: Plain async functions (TypeScript), no BullMQ/Redis
- Frontend/Admin: Next.js 15 + React 19 + Tailwind 4
- ORM: Prisma 6.4

## Monorepo Structure

```
/apps
  /admin        ← Next.js founder dashboard (port 3300)
  /api          ← Express webhook handlers (local dev server)
  /agency       ← SiteForge static site (index.html, checkout.html, request.html)
/workers
  /discovery    ← Finds businesses from Google Places / SerpAPI (plain async functions)
  /enrichment   ← Website audit, photo fetch, AI analysis
  /scoring      ← Rule-based lead scoring
  /page-gen     ← AI content generation + Handlebars rendering
  /deploy       ← R2 upload + claim bar injection
  /scheduler    ← Timezone-aware outreach scheduling
  /email        ← Resend email sending
  /extra-pages  ← AI-generated about/services/gallery pages
/functions      ← GCP Cloud Function HTTP entry points (production deployment)
/packages
  /db           ← Prisma schema + client (shared)
  /queue        ← Job payload type definitions (shared)
  /templates    ← Handlebars page templates + claim bar injection
  /ai           ← Claude CLI wrapper + business context builder
  /types        ← Shared TypeScript types
/infra
  /cf-worker    ← Cloudflare Worker for serving landing pages from R2
/scripts        ← Dev/test utility scripts (tsx)
```

## Deployment Architecture

### Landing Pages (draft.siteforge.agency)
- Generated HTML is uploaded to **Cloudflare R2** bucket `landing-pages` via `workers/deploy/`
- Served by **Cloudflare Worker** `lead-pages-router` at `/infra/cf-worker/`
- Worker config: `infra/cf-worker/wrangler.toml`
- Deploy worker: `npx wrangler deploy` from `/infra/cf-worker/`
- Worker secrets (set via `wrangler secret put`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Manual site folder deploy: `npx tsx scripts/deploy-site-folder.ts <folder> <slug>`

### Agency Site (siteforge.agency)
- Static HTML files in `/apps/agency/public/` — NO build step, NO package.json
- Hosted on **Cloudflare Pages** (project: `lead-gen`)
- **DEPLOYMENT IS MANUAL** — changes to checkout.html/index.html/request.html require manual deploy to Cloudflare Pages
- No CI/CD pipeline exists — must deploy via Cloudflare dashboard or `wrangler pages deploy apps/agency/public --project-name=lead-gen`

### Admin Dashboard
- Next.js app in `/apps/admin/`
- Currently runs locally (`pnpm dev` on port 3300)

### API / Cloud Functions (Production)
- **GCP Cloud Functions gen2** in `/functions/`
- Each webhook handler is an independent Cloud Function (scales to zero)
- Deploy all: `cd functions && bash deploy.sh`
- Cloud Scheduler sends hourly outreach via `sendDueOutreach` function
- See `functions/deploy-env.yaml.example` for environment variables

### API Server (Local Development)
- Express app in `/apps/api/`
- Same webhook handlers, mounted on Express routes
- Run locally: `pnpm dev` from `/apps/api/`

## Pipeline State Machine

Each business moves through these statuses (never backwards):

```
discovered → enriched → qualified | disqualified
qualified → page_generated → page_deployed
page_deployed → outreach_scheduled → outreach_sent
outreach_sent → replied | no_reply | bounced | unsubscribed
replied → converted
```

## Key Design Rules

- AI generates JSON only — never HTML. Templates do all rendering.
- All pipeline steps are plain async functions — no BullMQ, no Redis, no polling.
- GCP Cloud Functions handle all HTTP endpoints (production). Express app for local dev.
- Cloud Scheduler triggers hourly email sends via the `sendDueOutreach` function.
- Every function connects to Supabase via PgBouncer (port 6543, not 5432).
- Suppression check is mandatory before every email send — double guard.
- Human approval gate exists between qualified → page_generated in early operation.
- No LangGraph, no n8n — plain async functions only.

## Database Entities

- markets, businesses, preview_pages, intent_pages
- campaigns, outreach_messages, email_events, replies
- suppression_list, page_views, market_scans

## Agency: SiteForge

The platform operates under the brand "SiteForge" (siteforge.agency). Every deployed landing page gets a sticky "Claim This Website" bar injected at the top that links to the agency checkout page with `?slug=X&business=Y` params.

Agency assets live in `/apps/agency/public/`:
- `index.html` — Agency landing page
- `checkout.html` — Checkout page with plan selection, upsells, and payment flow
- `request.html` — Demo request form

The claim bar is injected by `@lead-gen/templates` `injectClaimBar()` during the deploy step in `workers/deploy/src/cloudflare.ts`.

### Pricing (Flat Fee + Upsells)
- **Website:** $199 one-time flat fee (includes hosting, security, mobile-friendly site)
- **No monthly base fee** — the $199 is the complete offer
- **Checkout upsells (opt-in toggles below main CTA):**
  - Custom Domain (+$10/mo) — ongoing cost, justified as monthly
  - Additional Pages ($29 one-time) — built once, priced once
  - Online Booking (+$19/mo) — ongoing service, justified as monthly
- **Post-purchase upsell sequence (NOT shown at checkout):**
  - Day 30: Google Business Profile management (+$19/mo)
  - Day 90: Review Booster Kit ($99 one-time)
  - Day 180: Logo & Brand Kit ($199 one-time)
- **Pricing principle:** one-time fees for things built once, monthly fees only for ongoing services
- **Future consideration:** offer first 3 months of hosting free, then $29/mo — revisit when we have conversion data

### Messaging Rules (MANDATORY)
- **Never say:** "subscription," "AI-generated," or lead with features
- **Always say:** "monthly" (not subscription), "custom-built" (not AI-generated), lead with "more phone calls" (not features)
- **Price anchoring:** Always reference local web designer cost ($3K-$5K) before revealing SiteForge price
- **Job-equivalent framing:** "$199 is less than one service call" — always translate price to their trade economics
- **Urgency (non-sleazy):** "We only build one preview site per trade per area. Claim it or we offer it to another [trade] in your city next week."
- **Never use on checkout page:** annual commitment options, feature jargon, tech terminology

## Environment Variables Needed

```
DATABASE_URL=              # Supabase PgBouncer URL (port 6543)
DIRECT_URL=                # Supabase direct URL (port 5432, for migrations only)
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
SERP_API_KEY=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
R2_ACCESS_KEY_ID=          # Cloudflare R2 credentials
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=landing-pages
CLOUDFLARE_PAGES_PROJECT=  # e.g. lead-gen
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
FOUNDER_EMAIL=             # All replies forwarded here
PREVIEW_BASE_URL=          # e.g. https://draft.siteforge.agency
TRACKING_API_URL=          # e.g. https://api.yourdomain.com/t (defaults to PREVIEW_BASE_URL/t)
FROM_EMAIL=                # Resend sender address
MAX_EMAILS_PER_DAY=500
AGENCY_CHECKOUT_URL=       # e.g. https://siteforge.agency/checkout
ADMIN_PASSWORD=            # Admin dashboard login
PAYMENT_WEBHOOK_SECRET=    # TODO: Payment provider webhook secret (Stripe, Lemon Squeezy, etc.)
# PAYMENT_EXTRA_PAGES_PRICE_ID= # TODO: Price ID for the "Additional Pages" upsell
```

## Useful Scripts

Run from repo root with `npx tsx scripts/<name>.ts`:
- `run-full-pipeline.ts` — End-to-end pipeline test
- `deploy-site-folder.ts <folder> <slug>` — Deploy static site folder to R2
- `run-discovery-enrich.ts` — Discovery + enrichment pipeline
- `run-pagegen-deploy.ts` — Page generation + deployment
- `add-markets.ts` — Bulk market addition
- `e2e-test.ts` — Complete end-to-end test

## Current Build Status

- [x] Monorepo scaffold (turborepo + pnpm workspaces)
- [x] Prisma schema (332 lines, all entities)
- [x] GCP Cloud Functions (serverless, replaces BullMQ/Redis)
- [x] Discovery processor (Google Places + SerpAPI)
- [x] Enrichment processor (website audit, photos, AI analysis)
- [x] Scoring engine (rule-based)
- [x] Page gen processor (Claude CLI + full HTML generation)
- [x] Deploy processor (R2 upload + claim bar injection)
- [x] Scheduler processor (timezone-aware outreach scheduling)
- [x] Email processor (Resend + suppression checks)
- [x] Reply ingestion webhook
- [x] Cloud Scheduler email sender (sendDueOutreach, hourly)
- [x] Pipeline orchestrator (runPipeline Cloud Function)
- [x] Admin dashboard (Next.js, 8+ pages)
- [x] Cloudflare Worker for landing page serving
- [x] Agency site (SiteForge landing, checkout, request pages)
- [x] GCP deploy script (functions/deploy.sh)
- [ ] GCP deployment (run deploy.sh + update webhook URLs)
- [ ] Delete Upstash Redis instance

# currentDate
Today's date is 2026-03-16.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.

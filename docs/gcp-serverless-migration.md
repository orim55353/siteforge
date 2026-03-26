# GCP Serverless Migration Plan

## Current Architecture (BullMQ + Redis)

Every pipeline step is a BullMQ worker that long-polls Redis (Upstash) for jobs. This requires persistent worker processes running somewhere.

```
API (Express) → enqueues jobs → Redis → BullMQ workers process them
```

Workers: discovery, enrichment, scoring, page-gen, deploy, scheduler, email, reply-ingestion, extra-pages

## Target Architecture (GCP Cloud Functions + Cloud Scheduler)

Fully serverless, $0/mo on GCP free tier. No Redis, no BullMQ, no VM.

```
Cloud Functions (HTTP-triggered)     → direct function calls between steps
Cloud Scheduler (hourly cron)        → triggers email sending function
Cloudflare Worker (already exists)   → serves landing pages from R2
```

## GCP Free Tier Limits

| Resource | Free Allowance |
|---|---|
| Cloud Functions invocations | 2M/month |
| Cloud Functions compute | 400K GB-seconds |
| Cloud Scheduler jobs | 3 jobs (we need 1) |
| Egress | 5 GB/month |
| Cloud Build | 120 min/day |

At current scale (tens of businesses, not thousands), we'll use <1% of these limits.

## What Changes

### 1. API → Cloud Functions (HTTP)

The Express app (`apps/api/`) becomes individual Cloud Functions:

| Current Route | Cloud Function |
|---|---|
| `POST /t` | `trackPageView` — records view, triggers extra-pages generation |
| `POST /webhooks/inbound` | `handleInboundEmail` — Resend reply ingestion |
| `POST /webhooks/email-events` | `handleEmailEvents` — delivery/bounce tracking |
| `POST /webhooks/paddle` | `handlePaddleWebhook` — order creation + fulfillment |
| `POST /ce` | `handleCheckoutEvent` — checkout tracking |
| `GET /health` | `healthCheck` |

Each function is independently deployable and scales to zero.

### 2. Pipeline Steps → Direct Function Calls

Instead of enqueueing BullMQ jobs, each step calls the next directly:

```
Discovery Cloud Function
  → calls Enrichment function for each business
    → calls Scoring function
      → calls PageGen function (if qualified)
        → calls Deploy function
```

Or: a single "pipeline orchestrator" Cloud Function that runs the full sequence for one business. Simpler, and fine at our scale.

### 3. Email Scheduler → Cloud Scheduler + Cloud Function

```
Cloud Scheduler (runs every hour)
  → triggers sendDueOutreach Cloud Function
    → queries DB for businesses with outreach due this hour
    → sends emails via Resend
    → updates status
```

### 4. Extra Pages → Triggered by Page View

Already implemented. The `trackPageView` function checks if extra pages exist for the slug and calls the generation logic directly (no queue).

### 5. Remove Redis/BullMQ

- Delete `packages/queue/` (or strip it to just type definitions)
- Remove Upstash Redis dependency
- Remove `REDIS_URL` from env vars

## GCP Setup Steps

### Prerequisites
- GCP account (new accounts get $300 free credits for 90 days)
- `gcloud` CLI installed (`brew install google-cloud-sdk`)
- Project created (`gcloud projects create siteforge-prod`)

### 1. Enable APIs
```bash
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
```

### 2. Deploy API Functions

Each webhook handler becomes a gen2 Cloud Function:

```bash
# Example: deploy page view tracker
gcloud functions deploy trackPageView \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=trackPageView \
  --source=./functions/track-page-view \
  --set-env-vars="DATABASE_URL=$DATABASE_URL,PREVIEW_BASE_URL=$PREVIEW_BASE_URL"
```

### 3. Set Up Cloud Scheduler

```bash
# Hourly email sending
gcloud scheduler jobs create http send-outreach-emails \
  --schedule="0 * * * *" \
  --uri="https://REGION-PROJECT.cloudfunctions.net/sendDueOutreach" \
  --http-method=POST \
  --time-zone="UTC"
```

### 4. Update Webhook URLs

- **Resend** inbound webhook → Cloud Function URL
- **Resend** email events webhook → Cloud Function URL
- **Paddle** webhook → Cloud Function URL
- **Cloudflare Worker** tracking URL → Cloud Function URL

### 5. Environment Variables

Set via `gcloud functions deploy --set-env-vars` or GCP Secret Manager:

```
DATABASE_URL
DIRECT_URL
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
SERP_API_KEY
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
SUPABASE_URL
SUPABASE_SERVICE_KEY
FOUNDER_EMAIL
PREVIEW_BASE_URL
FROM_EMAIL
MAX_EMAILS_PER_DAY
AGENCY_CHECKOUT_URL
PADDLE_WEBHOOK_SECRET
PADDLE_EXTRA_PAGES_PRICE_ID
```

## Migration Order

1. ~~**Create `functions/` directory** with individual function entry points~~ ✅ Done
2. ~~**Refactor pipeline steps** from BullMQ workers to plain async functions~~ ✅ Done
3. **Deploy API functions** to GCP and verify webhooks work → `cd functions && bash deploy.sh`
4. **Set up Cloud Scheduler** for hourly email sends → included in deploy.sh
5. **Update external webhook URLs** (Resend, Paddle, Cloudflare Worker) → point to GCP Function URLs
6. ~~**Remove BullMQ/Redis** dependencies~~ ✅ Done
7. **Delete Upstash Redis** instance → after verifying GCP deployment works

## Cost Summary

| Service | Monthly Cost |
|---|---|
| GCP Cloud Functions | $0 (within free tier) |
| GCP Cloud Scheduler | $0 (1 job, free tier = 3) |
| Supabase (Postgres) | $0 (free tier) |
| Cloudflare R2 | $0 (free tier: 10 GB storage, 10M reads) |
| Cloudflare Workers | $0 (free tier: 100K requests/day) |
| Cloudflare Pages | $0 (free tier) |
| Resend | $0 (free tier: 100 emails/day) |
| **Total** | **$0/mo** |

#!/usr/bin/env bash
#
# Deploy all Cloud Functions to GCP.
#
# Prerequisites:
#   - gcloud CLI installed (brew install google-cloud-sdk)
#   - GCP project created and selected (gcloud config set project siteforge-prod)
#   - APIs enabled:
#       gcloud services enable cloudfunctions.googleapis.com
#       gcloud services enable cloudscheduler.googleapis.com
#       gcloud services enable cloudbuild.googleapis.com
#       gcloud services enable run.googleapis.com
#
# Usage:
#   cd functions && bash deploy.sh
#
# Environment variables are set via .env.yaml (see deploy-env.yaml.example)

set -euo pipefail

REGION="us-central1"
RUNTIME="nodejs20"
ENV_FILE="deploy-env.yaml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Copy deploy-env.yaml.example and fill in values."
  exit 1
fi

echo "Building functions..."
cd .. && pnpm build && cd functions

echo ""
echo "=== Deploying API Cloud Functions ==="
echo ""

# Page view tracking (from Cloudflare Worker)
gcloud functions deploy trackPageView \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=trackPageView \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=256Mi \
  --timeout=300s

# Checkout event tracking
gcloud functions deploy handleCheckoutEvent \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=handleCheckoutEvent \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=256Mi \
  --timeout=30s

# Resend inbound email webhook
gcloud functions deploy handleInboundEmail \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=handleInboundEmail \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=256Mi \
  --timeout=30s

# Resend email events webhook
gcloud functions deploy handleEmailEvents \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=handleEmailEvents \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=256Mi \
  --timeout=30s

# Paddle payment webhook
gcloud functions deploy handlePaddleWebhook \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=handlePaddleWebhook \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=256Mi \
  --timeout=30s

# Health check
gcloud functions deploy healthCheck \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=healthCheck \
  --source=. \
  --memory=128Mi \
  --timeout=10s

echo ""
echo "=== Deploying Pipeline Cloud Functions ==="
echo ""

# Pipeline orchestrator (discovery → enrichment → scoring)
gcloud functions deploy runPipeline \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --no-allow-unauthenticated \
  --entry-point=runPipeline \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=1Gi \
  --timeout=540s

# Extra pages generation (AI-heavy, needs more resources)
gcloud functions deploy generateExtraPages \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --no-allow-unauthenticated \
  --entry-point=generateExtraPages \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=1Gi \
  --timeout=540s

# Scheduled email sending (triggered by Cloud Scheduler)
gcloud functions deploy sendDueOutreach \
  --gen2 \
  --runtime=$RUNTIME \
  --region=$REGION \
  --trigger-http \
  --no-allow-unauthenticated \
  --entry-point=sendDueOutreach \
  --source=. \
  --env-vars-file=$ENV_FILE \
  --memory=512Mi \
  --timeout=300s

echo ""
echo "=== Setting up Cloud Scheduler ==="
echo ""

# Get the sendDueOutreach function URL
OUTREACH_URL=$(gcloud functions describe sendDueOutreach --region=$REGION --gen2 --format="value(serviceConfig.uri)")

# Create or update the hourly scheduler job
gcloud scheduler jobs delete send-outreach-emails --location=$REGION --quiet 2>/dev/null || true
gcloud scheduler jobs create http send-outreach-emails \
  --location=$REGION \
  --schedule="0 * * * *" \
  --uri="$OUTREACH_URL" \
  --http-method=POST \
  --time-zone="UTC" \
  --oidc-service-account-email="$(gcloud config get-value account)" \
  --headers="Content-Type=application/json" \
  --message-body='{}'

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Cloud Function URLs:"
gcloud functions list --region=$REGION --gen2 --format="table(name,state,httpsTrigger.url)"
echo ""
echo "Cloud Scheduler Jobs:"
gcloud scheduler jobs list --location=$REGION

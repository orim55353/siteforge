-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('discovered', 'enriched', 'qualified', 'disqualified', 'page_generated', 'page_deployed', 'outreach_scheduled', 'outreach_sent', 'replied', 'no_reply', 'bounced', 'unsubscribed', 'converted');

-- CreateEnum
CREATE TYPE "OutreachMessageStatus" AS ENUM ('scheduled', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed');

-- CreateTable
CREATE TABLE "markets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "market_id" UUID NOT NULL,
    "status" "BusinessStatus" NOT NULL DEFAULT 'discovered',
    "google_place_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "google_rating" DOUBLE PRECISION,
    "review_count" INTEGER DEFAULT 0,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_website" BOOLEAN,
    "website_score" INTEGER,
    "has_ssl" BOOLEAN,
    "is_mobile_friendly" BOOLEAN,
    "has_online_booking" BOOLEAN,
    "tech_stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "social_profiles" JSONB,
    "score" INTEGER,
    "score_breakdown" JSONB,
    "timezone" TEXT DEFAULT 'America/Chicago',
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preview_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "ai_content" JSONB NOT NULL,
    "html_url" TEXT,
    "preview_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preview_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intent_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "ai_content" JSONB NOT NULL,
    "html_url" TEXT NOT NULL,
    "deployed_url" TEXT NOT NULL,
    "deployed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intent_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "template_id" TEXT,
    "subject_line" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "max_per_day" INTEGER NOT NULL DEFAULT 500,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "status" "OutreachMessageStatus" NOT NULL DEFAULT 'scheduled',
    "to_email" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "resend_id" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outreach_message_id" UUID NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outreach_message_id" UUID NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT,
    "body_html" TEXT,
    "forwarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_list" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "markets_industry_city_state_idx" ON "markets"("industry", "city", "state");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_google_place_id_key" ON "businesses"("google_place_id");

-- CreateIndex
CREATE INDEX "businesses_status_idx" ON "businesses"("status");

-- CreateIndex
CREATE INDEX "businesses_market_id_status_idx" ON "businesses"("market_id", "status");

-- CreateIndex
CREATE INDEX "businesses_score_idx" ON "businesses"("score");

-- CreateIndex
CREATE INDEX "businesses_email_idx" ON "businesses"("email");

-- CreateIndex
CREATE UNIQUE INDEX "preview_pages_slug_key" ON "preview_pages"("slug");

-- CreateIndex
CREATE INDEX "preview_pages_business_id_idx" ON "preview_pages"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "intent_pages_slug_key" ON "intent_pages"("slug");

-- CreateIndex
CREATE INDEX "intent_pages_business_id_idx" ON "intent_pages"("business_id");

-- CreateIndex
CREATE INDEX "outreach_messages_business_id_idx" ON "outreach_messages"("business_id");

-- CreateIndex
CREATE INDEX "outreach_messages_campaign_id_idx" ON "outreach_messages"("campaign_id");

-- CreateIndex
CREATE INDEX "outreach_messages_status_scheduled_for_idx" ON "outreach_messages"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outreach_messages_resend_id_idx" ON "outreach_messages"("resend_id");

-- CreateIndex
CREATE INDEX "email_events_outreach_message_id_idx" ON "email_events"("outreach_message_id");

-- CreateIndex
CREATE INDEX "email_events_type_idx" ON "email_events"("type");

-- CreateIndex
CREATE INDEX "replies_outreach_message_id_idx" ON "replies"("outreach_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_list_email_key" ON "suppression_list"("email");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_pages" ADD CONSTRAINT "preview_pages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intent_pages" ADD CONSTRAINT "intent_pages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_outreach_message_id_fkey" FOREIGN KEY ("outreach_message_id") REFERENCES "outreach_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_outreach_message_id_fkey" FOREIGN KEY ("outreach_message_id") REFERENCES "outreach_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "page_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "user_agent" TEXT,
    "referer" TEXT,
    "device_type" TEXT,
    "visitor_hash" TEXT,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_views_slug_idx" ON "page_views"("slug");

-- CreateIndex
CREATE INDEX "page_views_slug_viewed_at_idx" ON "page_views"("slug", "viewed_at");

-- CreateIndex
CREATE INDEX "page_views_visitor_hash_idx" ON "page_views"("visitor_hash");

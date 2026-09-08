-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('SHOPEE', 'TIKTOK_SHOP', 'AMAZON', 'MERCADO_LIVRE');

-- CreateEnum
CREATE TYPE "PollingTier" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DETECTED', 'PUBLISHED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "gtin" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOffer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalShopId" TEXT,
    "sellerName" TEXT,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ratingStar" DOUBLE PRECISION,
    "ratingCount" INTEGER,
    "salesCount" INTEGER,
    "commissionRateBp" INTEGER,
    "pollingTier" "PollingTier" NOT NULL DEFAULT 'WARM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCollectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "productOfferId" TEXT NOT NULL,
    "source" "Marketplace" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceCents" INTEGER NOT NULL,
    "shippingCents" INTEGER,
    "commissionCents" INTEGER,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "originalPriceCents" INTEGER,
    "discountRate" DOUBLE PRECISION,
    "rawData" JSONB,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPriceAggregate" (
    "id" TEXT NOT NULL,
    "productOfferId" TEXT NOT NULL,
    "source" "Marketplace" NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "minPriceCents" INTEGER NOT NULL,
    "maxPriceCents" INTEGER NOT NULL,
    "closePriceCents" INTEGER NOT NULL,
    "observationsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyPriceAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "productOfferId" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'DETECTED',
    "dealScore" INTEGER NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "evScore" DOUBLE PRECISION,
    "priceCents" INTEGER NOT NULL,
    "referencePriceCents" INTEGER NOT NULL,
    "discountRate" DOUBLE PRECISION NOT NULL,
    "minPrice90dCents" INTEGER,
    "commissionCents" INTEGER,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "preHikeDetected" BOOLEAN NOT NULL DEFAULT false,
    "scoreBreakdown" JSONB NOT NULL,
    "reasonsDiscarded" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealDecision" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "reason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "productOfferId" TEXT NOT NULL,
    "campaignId" TEXT,
    "shortLink" TEXT,
    "originalLink" TEXT NOT NULL,
    "subId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "affiliateLinkId" TEXT,
    "slug" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchKeyword" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "keyword" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_normalizedKey_key" ON "Product"("normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Product_gtin_key" ON "Product"("gtin");

-- CreateIndex
CREATE INDEX "Product_gtin_idx" ON "Product"("gtin");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "ProductOffer_pollingTier_active_idx" ON "ProductOffer"("pollingTier", "active");

-- CreateIndex
CREATE INDEX "ProductOffer_productId_idx" ON "ProductOffer"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOffer_marketplace_externalId_key" ON "ProductOffer"("marketplace", "externalId");

-- CreateIndex
CREATE INDEX "PriceObservation_productOfferId_observedAt_idx" ON "PriceObservation"("productOfferId", "observedAt");

-- CreateIndex
CREATE INDEX "PriceObservation_observedAt_idx" ON "PriceObservation"("observedAt");

-- CreateIndex
CREATE INDEX "DailyPriceAggregate_productOfferId_day_idx" ON "DailyPriceAggregate"("productOfferId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPriceAggregate_productOfferId_day_key" ON "DailyPriceAggregate"("productOfferId", "day");

-- CreateIndex
CREATE INDEX "Deal_status_dealScore_idx" ON "Deal"("status", "dealScore");

-- CreateIndex
CREATE INDEX "Deal_productOfferId_idx" ON "Deal"("productOfferId");

-- CreateIndex
CREATE INDEX "Deal_detectedAt_idx" ON "Deal"("detectedAt");

-- CreateIndex
CREATE INDEX "DealDecision_dealId_idx" ON "DealDecision"("dealId");

-- CreateIndex
CREATE INDEX "AffiliateLink_dealId_idx" ON "AffiliateLink"("dealId");

-- CreateIndex
CREATE INDEX "AffiliateLink_productOfferId_idx" ON "AffiliateLink"("productOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_name_key" ON "Campaign"("name");

-- CreateIndex
CREATE INDEX "Click_slug_idx" ON "Click"("slug");

-- CreateIndex
CREATE INDEX "Click_dealId_idx" ON "Click"("dealId");

-- CreateIndex
CREATE INDEX "SearchKeyword_marketplace_enabled_priority_idx" ON "SearchKeyword"("marketplace", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SearchKeyword_marketplace_keyword_key" ON "SearchKeyword"("marketplace", "keyword");

-- AddForeignKey
ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_productOfferId_fkey" FOREIGN KEY ("productOfferId") REFERENCES "ProductOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPriceAggregate" ADD CONSTRAINT "DailyPriceAggregate_productOfferId_fkey" FOREIGN KEY ("productOfferId") REFERENCES "ProductOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_productOfferId_fkey" FOREIGN KEY ("productOfferId") REFERENCES "ProductOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDecision" ADD CONSTRAINT "DealDecision_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_productOfferId_fkey" FOREIGN KEY ("productOfferId") REFERENCES "ProductOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

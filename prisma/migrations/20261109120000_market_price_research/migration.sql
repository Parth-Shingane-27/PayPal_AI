-- CreateTable
CREATE TABLE "market_price_research" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "result" JSONB NOT NULL,
    "offer_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_price_research_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_price_research_product_id_locale_created_at_idx" ON "market_price_research"("product_id", "locale", "created_at");

-- CreateIndex
CREATE INDEX "market_price_research_seller_id_idx" ON "market_price_research"("seller_id");

-- AddForeignKey
ALTER TABLE "market_price_research" ADD CONSTRAINT "market_price_research_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_research" ADD CONSTRAINT "market_price_research_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


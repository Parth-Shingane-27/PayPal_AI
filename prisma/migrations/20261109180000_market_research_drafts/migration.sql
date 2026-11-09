-- DropIndex
DROP INDEX "market_price_research_seller_id_idx";

-- AlterTable
ALTER TABLE "market_price_research" ADD COLUMN     "query_hash" TEXT,
ALTER COLUMN "product_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "market_price_research_seller_id_query_hash_locale_created_a_idx" ON "market_price_research"("seller_id", "query_hash", "locale", "created_at");


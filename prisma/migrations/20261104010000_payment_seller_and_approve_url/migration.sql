-- AlterTable: add the columns, backfill seller_id from the order, then enforce NOT NULL.
ALTER TABLE "payments" ADD COLUMN "approve_url" TEXT,
ADD COLUMN "seller_id" UUID;

UPDATE "payments" p SET "seller_id" = o."seller_id" FROM "orders" o WHERE o."id" = p."order_id";

ALTER TABLE "payments" ALTER COLUMN "seller_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "payments_seller_id_status_idx" ON "payments"("seller_id", "status");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

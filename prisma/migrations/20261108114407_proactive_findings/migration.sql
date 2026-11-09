-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('NEW', 'SEEN', 'SNOOZED', 'DISMISSED', 'ACTED', 'RESOLVED');

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "auto_payout_proposals" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "agent" "AgentName" NOT NULL,
    "type" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'NEW',
    "snoozed_until" TIMESTAMPTZ(3),
    "session_id" UUID,
    "action_id" UUID,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "findings_seller_id_status_idx" ON "findings"("seller_id", "status");

-- CreateIndex
CREATE INDEX "findings_seller_id_fingerprint_idx" ON "findings"("seller_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open finding per seller and fingerprint; resolved ones may repeat.
CREATE UNIQUE INDEX "findings_open_fingerprint_key" ON "findings"("seller_id", "fingerprint") WHERE "status" <> 'RESOLVED';

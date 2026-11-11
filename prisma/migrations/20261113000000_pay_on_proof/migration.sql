-- CreateEnum
CREATE TYPE "CriterionStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CriterionSource" AS ENUM ('AI', 'FREELANCER', 'CLIENT');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'AUTHORIZED';

-- AlterTable
ALTER TABLE "milestone_payments" ADD COLUMN     "authorization_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "authorization_id" TEXT,
ADD COLUMN     "authorized_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "acceptance_criteria" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "source" "CriterionSource" NOT NULL,
    "status" "CriterionStatus" NOT NULL DEFAULT 'PENDING',
    "client_signed_at" TIMESTAMPTZ(3),
    "freelancer_signed_at" TIMESTAMPTZ(3),
    "verdict_note" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "acceptance_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acceptance_criteria_milestone_id_position_key" ON "acceptance_criteria"("milestone_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_payments_authorization_id_key" ON "milestone_payments"("authorization_id");

-- AddForeignKey
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;


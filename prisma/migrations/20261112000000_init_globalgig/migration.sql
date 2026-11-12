-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'COMPLETED', 'DECLINED', 'FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PROPOSED', 'REJECTED', 'PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayoutScheduleStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PROPOSED', 'SCHEDULED', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentName" AS ENUM ('PROFILE', 'HIRING');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'FREELANCER', 'CLIENT');

-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('IDLE', 'RUNNING');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('NEW', 'SEEN', 'SNOOZED', 'DISMISSED', 'ACTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('TOOL', 'PAYPAL', 'MODEL');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXECUTION_FAILED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'LIMITED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ContractSource" AS ENUM ('QUOTE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MilestoneState" AS ENUM ('AWAITING_FUNDING', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'REVISION_REQUESTED', 'ACCEPTED', 'DISPUTED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReleaseKind" AS ENUM ('CLIENT_ACCEPTED', 'AUTO_RELEASED', 'DISPUTE_RESOLVED');

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "agent" "AgentName" NOT NULL,
    "actor" "ActorType" NOT NULL,
    "freelancer_id" UUID,
    "client_id" UUID,
    "locale" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'IDLE',
    "run_started_at" TIMESTAMPTZ(3),
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_actions" (
    "id" UUID NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "agent" "AgentName",
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "ActionStatus" NOT NULL,
    "error" TEXT,
    "rationale" TEXT,
    "actor" "ActorType" NOT NULL,
    "actor_id" UUID,
    "session_id" UUID,
    "freelancer_id" UUID,
    "milestone_refund_id" UUID,
    "freelancer_payout_schedule_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID,
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

-- CreateTable
CREATE TABLE "freelancers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "paypal_email" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "locale" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'AVAILABLE',
    "portfolio_links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hourly_floor_minor" INTEGER NOT NULL,
    "invoice_prefix" TEXT NOT NULL,
    "invoice_seq" INTEGER NOT NULL DEFAULT 0,
    "auto_payout_proposals" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freelancers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "company_name" TEXT,
    "tax_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budget_minor" INTEGER,
    "budget_currency" CHAR(3),
    "deadline" DATE,
    "status" "BriefStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "brief_id" UUID,
    "locale" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SENT',
    "request_message" TEXT NOT NULL,
    "total_minor" INTEGER,
    "delivery_days" INTEGER,
    "revisions" INTEGER,
    "scope" TEXT,
    "message" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "source" "ContractSource" NOT NULL,
    "quote_id" UUID,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "revisions_allowed" INTEGER NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "activated_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "due_date" DATE,
    "state" "MilestoneState" NOT NULL DEFAULT 'AWAITING_FUNDING',
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "funded_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "auto_release_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "release_kind" "ReleaseKind",
    "disputed_at" TIMESTAMPTZ(3),
    "dispute_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_events" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "from_state" "MilestoneState" NOT NULL,
    "to_state" "MilestoneState" NOT NULL,
    "actor" "ActorType" NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_payments" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "paypal_order_id" TEXT NOT NULL,
    "approve_url" TEXT,
    "paypal_invoice_id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "currency" CHAR(3) NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "paypal_fee_minor" INTEGER,
    "fee_is_estimate" BOOLEAN NOT NULL DEFAULT false,
    "platform_fee_minor" INTEGER,
    "fx_cost_minor" INTEGER,
    "net_to_freelancer_minor" INTEGER,
    "capture_id" TEXT,
    "failure_reason" TEXT,
    "captured_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "milestone_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "from_holding" BOOLEAN NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PROPOSED',
    "paypal_refund_id" TEXT,
    "paypal_fee_returned_minor" INTEGER,
    "platform_fee_returned_minor" INTEGER,
    "freelancer_debit_minor" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "milestone_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "freelancer_name" TEXT NOT NULL,
    "freelancer_country" CHAR(2) NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_company" TEXT,
    "client_tax_id" TEXT,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_payout_schedules" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutScheduleStatus" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freelancer_payout_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freelancer_payouts" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "fee_minor" INTEGER NOT NULL,
    "fee_is_estimate" BOOLEAN NOT NULL DEFAULT true,
    "receiver_email" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PROPOSED',
    "sender_batch_id" TEXT NOT NULL,
    "paypal_batch_id" TEXT,
    "error" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "freelancer_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" UUID NOT NULL,
    "freelancer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "brief_id" UUID,
    "quote_id" UUID,
    "contract_id" UUID,
    "subject" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freelancer_unread" INTEGER NOT NULL DEFAULT 0,
    "client_unread" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender" "ActorType" NOT NULL,
    "body" TEXT NOT NULL,
    "body_locale" TEXT NOT NULL,
    "translation" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "message_id" UUID,
    "milestone_id" UUID,
    "uploaded_by" "ActorType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_sessions_freelancer_id_idx" ON "agent_sessions"("freelancer_id");

-- CreateIndex
CREATE INDEX "agent_sessions_client_id_idx" ON "agent_sessions"("client_id");

-- CreateIndex
CREATE INDEX "agent_actions_freelancer_id_created_at_idx" ON "agent_actions"("freelancer_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_session_id_created_at_idx" ON "agent_actions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_actions_status_idx" ON "agent_actions"("status");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE INDEX "findings_freelancer_id_status_idx" ON "findings"("freelancer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "freelancers_email_key" ON "freelancers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "freelancers_invoice_prefix_key" ON "freelancers"("invoice_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "clients_email_key" ON "clients"("email");

-- CreateIndex
CREATE INDEX "briefs_client_id_status_idx" ON "briefs"("client_id", "status");

-- CreateIndex
CREATE INDEX "quotes_freelancer_id_status_idx" ON "quotes"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "quotes_client_id_status_idx" ON "quotes"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_quote_id_key" ON "contracts"("quote_id");

-- CreateIndex
CREATE INDEX "contracts_client_id_status_idx" ON "contracts"("client_id", "status");

-- CreateIndex
CREATE INDEX "contracts_freelancer_id_status_idx" ON "contracts"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "milestones_freelancer_id_state_idx" ON "milestones"("freelancer_id", "state");

-- CreateIndex
CREATE INDEX "milestones_client_id_state_idx" ON "milestones"("client_id", "state");

-- CreateIndex
CREATE INDEX "milestones_state_auto_release_at_idx" ON "milestones"("state", "auto_release_at");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_contract_id_position_key" ON "milestones"("contract_id", "position");

-- CreateIndex
CREATE INDEX "milestone_events_milestone_id_created_at_idx" ON "milestone_events"("milestone_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_payments_paypal_order_id_key" ON "milestone_payments"("paypal_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_payments_paypal_invoice_id_key" ON "milestone_payments"("paypal_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_payments_capture_id_key" ON "milestone_payments"("capture_id");

-- CreateIndex
CREATE INDEX "milestone_payments_milestone_id_idx" ON "milestone_payments"("milestone_id");

-- CreateIndex
CREATE INDEX "milestone_payments_freelancer_id_status_idx" ON "milestone_payments"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "milestone_payments_status_idx" ON "milestone_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_refunds_paypal_refund_id_key" ON "milestone_refunds"("paypal_refund_id");

-- CreateIndex
CREATE INDEX "milestone_refunds_freelancer_id_status_idx" ON "milestone_refunds"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "milestone_refunds_payment_id_idx" ON "milestone_refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_milestone_id_key" ON "invoices"("milestone_id");

-- CreateIndex
CREATE INDEX "invoices_client_id_issued_at_idx" ON "invoices"("client_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_freelancer_id_seq_key" ON "invoices"("freelancer_id", "seq");

-- CreateIndex
CREATE INDEX "freelancer_payout_schedules_freelancer_id_idx" ON "freelancer_payout_schedules"("freelancer_id");

-- CreateIndex
CREATE UNIQUE INDEX "freelancer_payouts_sender_batch_id_key" ON "freelancer_payouts"("sender_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "freelancer_payouts_paypal_batch_id_key" ON "freelancer_payouts"("paypal_batch_id");

-- CreateIndex
CREATE INDEX "freelancer_payouts_freelancer_id_status_idx" ON "freelancer_payouts"("freelancer_id", "status");

-- CreateIndex
CREATE INDEX "threads_freelancer_id_last_message_at_idx" ON "threads"("freelancer_id", "last_message_at");

-- CreateIndex
CREATE INDEX "threads_client_id_last_message_at_idx" ON "threads"("client_id", "last_message_at");

-- CreateIndex
CREATE INDEX "thread_messages_thread_id_created_at_idx" ON "thread_messages"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_milestone_id_idx" ON "attachments"("milestone_id");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_milestone_refund_id_fkey" FOREIGN KEY ("milestone_refund_id") REFERENCES "milestone_refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_freelancer_payout_schedule_id_fkey" FOREIGN KEY ("freelancer_payout_schedule_id") REFERENCES "freelancer_payout_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_events" ADD CONSTRAINT "milestone_events_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_payments" ADD CONSTRAINT "milestone_payments_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_payments" ADD CONSTRAINT "milestone_payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_payments" ADD CONSTRAINT "milestone_payments_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_payments" ADD CONSTRAINT "milestone_payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_refunds" ADD CONSTRAINT "milestone_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "milestone_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_refunds" ADD CONSTRAINT "milestone_refunds_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_refunds" ADD CONSTRAINT "milestone_refunds_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_refunds" ADD CONSTRAINT "milestone_refunds_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_payout_schedules" ADD CONSTRAINT "freelancer_payout_schedules_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_payouts" ADD CONSTRAINT "freelancer_payouts_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "freelancer_payout_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freelancer_payouts" ADD CONSTRAINT "freelancer_payouts_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "freelancers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "thread_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One open finding per freelancer and fingerprint (partial unique index; Prisma cannot express it).
CREATE UNIQUE INDEX "findings_open_freelancer_fingerprint_key" ON "findings"("freelancer_id", "fingerprint") WHERE "status" <> 'RESOLVED' AND "freelancer_id" IS NOT NULL;

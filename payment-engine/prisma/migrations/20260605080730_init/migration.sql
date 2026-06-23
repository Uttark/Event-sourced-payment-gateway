-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'INR', 'EUR', 'GBP');

-- CreateEnum
CREATE TYPE "TransactionEventType" AS ENUM ('INITIALIZED', 'GATEWAY_CHARGE_SUCCEEDED', 'GATEWAY_CHARGE_FAILED', 'PAYMENT_COMPLETED', 'PAYMENT_FAILED', 'DEPOSIT_INITIATED', 'DEPOSIT_COMPLETED', 'FRAUD_FLAGGED', 'FRAUD_CLEARED', 'REFUND_INITIATED', 'REFUND_COMPLETED', 'REFUND_FAILED', 'PAYOUT_INITIATED', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" "TransactionEventType" NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" "Currency" NOT NULL,
    "gateway_order_id" TEXT,
    "gateway_payment_id" TEXT,
    "idempotency_key" TEXT,
    "fraud_score" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_projections" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_credited" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_debited" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "last_event_id" TEXT,
    "last_transaction_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "consumer_group" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "event_types" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_endpoint_id" TEXT NOT NULL,
    "transaction_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_http_status_code" INTEGER,
    "last_response_body" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_webhooks" (
    "id" TEXT NOT NULL,
    "webhook_delivery_id" TEXT NOT NULL,
    "webhook_endpoint_id" TEXT NOT NULL,
    "transaction_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "failure_reason" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "dead_letter_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_logs" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "gateway_order_id" TEXT NOT NULL,
    "gateway_status" TEXT NOT NULL,
    "action_taken" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "gateway_payout_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_events_event_id_key" ON "transaction_events"("event_id");

-- CreateIndex
CREATE INDEX "transaction_events_transaction_id_idx" ON "transaction_events"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_events_wallet_id_created_at_idx" ON "transaction_events"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_events_user_id_created_at_idx" ON "transaction_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_events_event_type_created_at_idx" ON "transaction_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "transaction_events_gateway_order_id_idx" ON "transaction_events"("gateway_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_projections_wallet_id_key" ON "wallet_projections"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_projections_user_id_idx" ON "wallet_projections"("user_id");

-- CreateIndex
CREATE INDEX "processed_events_event_id_idx" ON "processed_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_events_event_id_consumer_group_key" ON "processed_events"("event_id", "consumer_group");

-- CreateIndex
CREATE INDEX "merchants_user_id_idx" ON "merchants"("user_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_merchant_id_idx" ON "webhook_endpoints"("merchant_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_transaction_event_id_idx" ON "webhook_deliveries"("transaction_event_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letter_webhooks_webhook_delivery_id_key" ON "dead_letter_webhooks"("webhook_delivery_id");

-- CreateIndex
CREATE INDEX "dead_letter_webhooks_webhook_endpoint_id_idx" ON "dead_letter_webhooks"("webhook_endpoint_id");

-- CreateIndex
CREATE INDEX "dead_letter_webhooks_created_at_idx" ON "dead_letter_webhooks"("created_at");

-- CreateIndex
CREATE INDEX "reconciliation_logs_transaction_id_idx" ON "reconciliation_logs"("transaction_id");

-- CreateIndex
CREATE INDEX "reconciliation_logs_run_at_idx" ON "reconciliation_logs"("run_at");

-- CreateIndex
CREATE INDEX "payouts_merchant_id_status_idx" ON "payouts"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "payouts_scheduled_at_status_idx" ON "payouts"("scheduled_at", "status");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_endpoint_id_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

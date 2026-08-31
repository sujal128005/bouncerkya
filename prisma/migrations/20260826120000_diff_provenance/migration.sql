-- AlterTable
ALTER TABLE "AuthorizationDiff" ADD COLUMN "computedAt" DATETIME;
ALTER TABLE "AuthorizationDiff" ADD COLUMN "engineLatencyMs" INTEGER;
ALTER TABLE "AuthorizationDiff" ADD COLUMN "model" TEXT;
ALTER TABLE "AuthorizationDiff" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'fixture';

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN "engineFailureDetails" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "engineFailureReason" TEXT;

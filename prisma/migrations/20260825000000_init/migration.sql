-- CreateTable
CREATE TABLE "Principal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operatorName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "publicKeyRef" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "principalId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "categoryScope" TEXT NOT NULL,
    "spendCapMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expiresAt" DATETIME NOT NULL,
    "nonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Mandate_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Mandate_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mandateId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "sessionStructuredFields" TEXT NOT NULL,
    "sessionFreeText" TEXT,
    "injectionMarkerDetected" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseRequest_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseRequestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "sourceListingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "CartItem_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthorizationDiff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseRequestId" TEXT NOT NULL,
    "overallVerdictRecommendation" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "summary" TEXT NOT NULL,
    CONSTRAINT "AuthorizationDiff_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiffClause" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorizationDiffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "mandateValue" TEXT NOT NULL,
    "attemptedValue" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "DiffClause_authorizationDiffId_fkey" FOREIGN KEY ("authorizationDiffId") REFERENCES "AuthorizationDiff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseRequestId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authorizationDiffId" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    CONSTRAINT "PolicyDecision_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PolicyDecision_authorizationDiffId_fkey" FOREIGN KEY ("authorizationDiffId") REFERENCES "AuthorizationDiff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StepUpRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyDecisionId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "respondedAt" DATETIME,
    CONSTRAINT "StepUpRequest_policyDecisionId_fkey" FOREIGN KEY ("policyDecisionId") REFERENCES "PolicyDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StepUpRequest_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseRequestId" TEXT NOT NULL,
    "policyDecisionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "previousEventHash" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "AuditEvent_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_policyDecisionId_fkey" FOREIGN KEY ("policyDecisionId") REFERENCES "PolicyDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_nonce_key" ON "Mandate"("nonce");

-- CreateIndex
CREATE INDEX "Mandate_principalId_idx" ON "Mandate"("principalId");

-- CreateIndex
CREATE INDEX "Mandate_agentId_idx" ON "Mandate"("agentId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_mandateId_idx" ON "PurchaseRequest"("mandateId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_agentId_idx" ON "PurchaseRequest"("agentId");

-- CreateIndex
CREATE INDEX "CartItem_purchaseRequestId_idx" ON "CartItem"("purchaseRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizationDiff_purchaseRequestId_key" ON "AuthorizationDiff"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "DiffClause_authorizationDiffId_idx" ON "DiffClause"("authorizationDiffId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDecision_purchaseRequestId_key" ON "PolicyDecision"("purchaseRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDecision_authorizationDiffId_key" ON "PolicyDecision"("authorizationDiffId");

-- CreateIndex
CREATE UNIQUE INDEX "StepUpRequest_policyDecisionId_key" ON "StepUpRequest"("policyDecisionId");

-- CreateIndex
CREATE INDEX "StepUpRequest_principalId_idx" ON "StepUpRequest"("principalId");

-- CreateIndex
CREATE INDEX "AuditEvent_purchaseRequestId_idx" ON "AuditEvent"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "AuditEvent_policyDecisionId_idx" ON "AuditEvent"("policyDecisionId");

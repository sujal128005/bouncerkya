-- CreateTable
CREATE TABLE "ConsumedNonce" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "mandateId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "consumedAt" DATETIME NOT NULL,
    CONSTRAINT "ConsumedNonce_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumedNonce_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PolicyDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseRequestId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authorizationDiffId" TEXT,
    "decidedAt" DATETIME NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    CONSTRAINT "PolicyDecision_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PolicyDecision_authorizationDiffId_fkey" FOREIGN KEY ("authorizationDiffId") REFERENCES "AuthorizationDiff" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PolicyDecision" ("authorizationDiffId", "decidedAt", "id", "latencyMs", "outcome", "purchaseRequestId", "reason") SELECT "authorizationDiffId", "decidedAt", "id", "latencyMs", "outcome", "purchaseRequestId", "reason" FROM "PolicyDecision";
DROP TABLE "PolicyDecision";
ALTER TABLE "new_PolicyDecision" RENAME TO "PolicyDecision";
CREATE UNIQUE INDEX "PolicyDecision_purchaseRequestId_key" ON "PolicyDecision"("purchaseRequestId");
CREATE UNIQUE INDEX "PolicyDecision_authorizationDiffId_key" ON "PolicyDecision"("authorizationDiffId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedNonce_mandateId_key" ON "ConsumedNonce"("mandateId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedNonce_purchaseRequestId_key" ON "ConsumedNonce"("purchaseRequestId");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sequence" INTEGER NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "policyDecisionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "previousEventHash" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "AuditEvent_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_policyDecisionId_fkey" FOREIGN KEY ("policyDecisionId") REFERENCES "PolicyDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AuditEvent" ("createdAt", "id", "payloadHash", "policyDecisionId", "previousEventHash", "purchaseRequestId", "sequence", "eventType", "payload") SELECT "createdAt", "id", "payloadHash", "policyDecisionId", "previousEventHash", "purchaseRequestId", 0, 'policy_decision', '{}' FROM "AuditEvent";
DROP TABLE "AuditEvent";
ALTER TABLE "new_AuditEvent" RENAME TO "AuditEvent";
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "AuditEvent"("sequence");
CREATE INDEX "AuditEvent_purchaseRequestId_idx" ON "AuditEvent"("purchaseRequestId");
CREATE INDEX "AuditEvent_policyDecisionId_idx" ON "AuditEvent"("policyDecisionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

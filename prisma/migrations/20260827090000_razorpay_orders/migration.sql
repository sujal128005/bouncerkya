-- CreateTable
CREATE TABLE "RazorpayOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseRequestId" TEXT NOT NULL,
    "policyDecisionId" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "razorpayPaymentId" TEXT,
    "paymentStatus" TEXT,
    "paymentUpdatedAt" DATETIME,
    CONSTRAINT "RazorpayOrder_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RazorpayOrder_policyDecisionId_fkey" FOREIGN KEY ("policyDecisionId") REFERENCES "PolicyDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayOrder_purchaseRequestId_key" ON "RazorpayOrder"("purchaseRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayOrder_policyDecisionId_key" ON "RazorpayOrder"("policyDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "RazorpayOrder_razorpayOrderId_key" ON "RazorpayOrder"("razorpayOrderId");

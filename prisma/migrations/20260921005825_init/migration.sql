-- CreateTable
CREATE TABLE "Intake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budgetRange" TEXT NOT NULL,
    "timeline" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Enrichment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intakeId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "risks" TEXT,
    "source" TEXT,
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "promptVersion" TEXT,
    "rawResponse" TEXT,
    "latencyMs" INTEGER,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Enrichment_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intakeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "Tag_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "intakeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Intake_createdAt_idx" ON "Intake"("createdAt");

-- CreateIndex
CREATE INDEX "Intake_status_idx" ON "Intake"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Enrichment_intakeId_key" ON "Enrichment"("intakeId");

-- CreateIndex
CREATE INDEX "Enrichment_state_nextAttemptAt_idx" ON "Enrichment"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Enrichment_state_leaseExpiresAt_idx" ON "Enrichment"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Tag_label_idx" ON "Tag"("label");

-- CreateIndex
CREATE INDEX "Event_intakeId_seq_idx" ON "Event"("intakeId", "seq");

-- CreateIndex
CREATE INDEX "Event_seq_idx" ON "Event"("seq");

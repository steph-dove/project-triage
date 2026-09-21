-- CreateIndex
CREATE INDEX "Enrichment_state_source_updatedAt_idx" ON "Enrichment"("state", "source", "updatedAt");

-- CreateIndex
CREATE INDEX "Event_type_createdAt_idx" ON "Event"("type", "createdAt");

ALTER TABLE "Organization"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "scheduledDeletionAt" TIMESTAMP(3);

CREATE INDEX "Organization_scheduledDeletionAt_idx" ON "Organization"("scheduledDeletionAt");

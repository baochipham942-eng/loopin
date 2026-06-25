CREATE TABLE IF NOT EXISTS "TopicSignal" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "label" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "city" TEXT,
    "industries" TEXT NOT NULL,
    "audiences" TEXT NOT NULL,
    "formats" TEXT NOT NULL,
    "heat" INTEGER NOT NULL DEFAULT 50,
    "evidence" TEXT NOT NULL,
    "opportunity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TopicSignal_source_externalId_key"
  ON "TopicSignal"("source", "externalId");

CREATE INDEX IF NOT EXISTS "TopicSignal_status_updatedAt_idx"
  ON "TopicSignal"("status", "updatedAt");

CREATE INDEX IF NOT EXISTS "TopicSignal_source_status_idx"
  ON "TopicSignal"("source", "status");

CREATE TABLE IF NOT EXISTS "AttributionEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventId" TEXT,
    "registrationId" TEXT,
    "userId" TEXT,
    "source" TEXT,
    "channel" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "path" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AttributionEvent_eventId_type_createdAt_idx"
  ON "AttributionEvent"("eventId", "type", "createdAt");

CREATE INDEX IF NOT EXISTS "AttributionEvent_registrationId_createdAt_idx"
  ON "AttributionEvent"("registrationId", "createdAt");

CREATE INDEX IF NOT EXISTS "AttributionEvent_userId_createdAt_idx"
  ON "AttributionEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AttributionEvent_utmSource_createdAt_idx"
  ON "AttributionEvent"("utmSource", "createdAt");

CREATE INDEX IF NOT EXISTS "AttributionEvent_channel_createdAt_idx"
  ON "AttributionEvent"("channel", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AttributionEvent_eventId_fkey'
  ) THEN
    ALTER TABLE "AttributionEvent"
      ADD CONSTRAINT "AttributionEvent_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AttributionEvent_registrationId_fkey'
  ) THEN
    ALTER TABLE "AttributionEvent"
      ADD CONSTRAINT "AttributionEvent_registrationId_fkey"
      FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AttributionEvent_userId_fkey'
  ) THEN
    ALTER TABLE "AttributionEvent"
      ADD CONSTRAINT "AttributionEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

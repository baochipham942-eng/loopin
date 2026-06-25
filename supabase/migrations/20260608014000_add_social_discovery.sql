CREATE TABLE IF NOT EXISTS "EventSocialProfile" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'guest',
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "tags" TEXT NOT NULL,
    "links" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSocialProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InterestSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "city" TEXT,
    "industry" TEXT,
    "format" TEXT,
    "sourceEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterestSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EventSocialProfile_eventId_visibility_kind_idx"
  ON "EventSocialProfile"("eventId", "visibility", "kind");

CREATE INDEX IF NOT EXISTS "EventSocialProfile_kind_sortOrder_idx"
  ON "EventSocialProfile"("kind", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "InterestSubscription_userId_subscriptionKey_key"
  ON "InterestSubscription"("userId", "subscriptionKey");

CREATE INDEX IF NOT EXISTS "InterestSubscription_status_city_updatedAt_idx"
  ON "InterestSubscription"("status", "city", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EventSocialProfile_eventId_fkey'
  ) THEN
    ALTER TABLE "EventSocialProfile"
      ADD CONSTRAINT "EventSocialProfile_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InterestSubscription_userId_fkey'
  ) THEN
    ALTER TABLE "InterestSubscription"
      ADD CONSTRAINT "InterestSubscription_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

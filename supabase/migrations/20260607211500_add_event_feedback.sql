CREATE TABLE IF NOT EXISTS "EventFeedback" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "registrationId" TEXT,
    "rating" INTEGER,
    "valuable" TEXT NOT NULL,
    "nextTopic" TEXT NOT NULL,
    "roleInterest" TEXT NOT NULL,
    "note" TEXT,
    "answers" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventFeedback_eventId_userId_key"
  ON "EventFeedback"("eventId", "userId");

CREATE INDEX IF NOT EXISTS "EventFeedback_eventId_createdAt_idx"
  ON "EventFeedback"("eventId", "createdAt");

CREATE INDEX IF NOT EXISTS "EventFeedback_userId_createdAt_idx"
  ON "EventFeedback"("userId", "createdAt");

ALTER TABLE "EventFeedback"
  ADD CONSTRAINT "EventFeedback_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EventFeedback"
  ADD CONSTRAINT "EventFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "NotificationSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'event_reminder',
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "reminderAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationSubscription_userId_eventId_type_key"
  ON "NotificationSubscription"("userId", "eventId", "type");

CREATE INDEX IF NOT EXISTS "NotificationSubscription_type_status_reminderAt_sentAt_idx"
  ON "NotificationSubscription"("type", "status", "reminderAt", "sentAt");

CREATE INDEX IF NOT EXISTS "NotificationSubscription_eventId_type_status_idx"
  ON "NotificationSubscription"("eventId", "type", "status");

ALTER TABLE "NotificationSubscription"
  ADD CONSTRAINT "NotificationSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationSubscription"
  ADD CONSTRAINT "NotificationSubscription_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

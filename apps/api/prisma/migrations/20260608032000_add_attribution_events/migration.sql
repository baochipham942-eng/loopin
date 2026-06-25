-- CreateTable
CREATE TABLE "AttributionEvent" (
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

-- CreateIndex
CREATE INDEX "AttributionEvent_eventId_type_createdAt_idx" ON "AttributionEvent"("eventId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_registrationId_createdAt_idx" ON "AttributionEvent"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_userId_createdAt_idx" ON "AttributionEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_utmSource_createdAt_idx" ON "AttributionEvent"("utmSource", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_channel_createdAt_idx" ON "AttributionEvent"("channel", "createdAt");

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add nullable check-in token for structured QR payload validation.
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "checkinToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Registration_checkinToken_key" ON "Registration"("checkinToken");

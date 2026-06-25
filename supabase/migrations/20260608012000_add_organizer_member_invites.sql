ALTER TABLE "OrganizerMember" ADD COLUMN IF NOT EXISTS "inviteTokenHash" TEXT;
ALTER TABLE "OrganizerMember" ADD COLUMN IF NOT EXISTS "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "OrganizerMember" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "OrganizerMember" ADD COLUMN IF NOT EXISTS "accessTokenHash" TEXT;
ALTER TABLE "OrganizerMember" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizerMember_inviteTokenHash_key"
  ON "OrganizerMember"("inviteTokenHash");

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizerMember_accessTokenHash_key"
  ON "OrganizerMember"("accessTokenHash");

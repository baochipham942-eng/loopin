-- AlterTable
ALTER TABLE "OrganizerMember" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "OrganizerMember" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "OrganizerMember" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "OrganizerMember" ADD COLUMN "accessTokenHash" TEXT;
ALTER TABLE "OrganizerMember" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerMember_inviteTokenHash_key" ON "OrganizerMember"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerMember_accessTokenHash_key" ON "OrganizerMember"("accessTokenHash");

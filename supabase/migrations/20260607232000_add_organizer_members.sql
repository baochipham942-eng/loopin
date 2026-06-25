CREATE TABLE IF NOT EXISTS "OrganizerMember" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "permissions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizerMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizerMember_organizerId_email_key"
  ON "OrganizerMember"("organizerId", "email");

CREATE INDEX IF NOT EXISTS "OrganizerMember_organizerId_status_idx"
  ON "OrganizerMember"("organizerId", "status");

ALTER TABLE "OrganizerMember"
  ADD CONSTRAINT "OrganizerMember_organizerId_fkey"
  FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

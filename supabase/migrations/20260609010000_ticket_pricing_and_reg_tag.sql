-- 早鸟价 / 邀请码票
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "earlyBirdPriceCents" INTEGER;
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "earlyBirdUntil" TIMESTAMP(3);
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "inviteCode" TEXT;

-- 现场重点标记（guest/vip/staff）
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "tag" TEXT;

-- 票种停售状态：active/archived（不硬删以保历史订单）
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

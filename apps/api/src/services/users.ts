import type { PrismaClient } from "@prisma/client";
import { buildCheckinPayload } from "./registration.js";

export interface UserRegistrationTicket {
  registrationId: string;
  eventId: string;
  title: string;
  city: string;
  venue: string | null;
  startAt: Date;
  status: string;
  ticketName: string;
  checkinToken: string | null;
  checkinPayload: string | null;
  amountCents: number | null;
  orderLifecycle: string | null;
  paymentStatus: string | null;
  waitlistPosition: number | null;
  waitlistStatus: string | null;
  waitlistOfferExpiresAt: Date | null;
  ended: boolean;
  canReview: boolean;
  canCancel: boolean;
  createdAt: Date;
}

export async function listUserRegistrations(db: PrismaClient, userId: string): Promise<UserRegistrationTicket[]> {
  const regs = await db.registration.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { event: true, ticketType: true, order: true, waitlistEntry: true },
  });

  const now = Date.now();
  return regs.map((r) => {
    const canCheckin = r.status === "approved" || r.status === "checked_in";
    const ended = r.event.startAt.getTime() < now || r.event.status === "completed";
    const canCancel =
      !ended &&
      ["submitted", "approved", "waitlisted"].includes(r.status) &&
      r.order?.lifecycle !== "cancelled" &&
      r.order?.lifecycle !== "abandoned" &&
      r.waitlistEntry?.status !== "cancelled";
    return {
      registrationId: r.id,
      eventId: r.eventId,
      title: r.event.title,
      city: r.event.city,
      venue: r.event.venue,
      startAt: r.event.startAt,
      status: r.status,
      ticketName: r.ticketType.name,
      checkinToken: canCheckin ? r.checkinToken : null,
      checkinPayload: canCheckin ? buildCheckinPayload(r.eventId, r.id, r.checkinToken) : null,
      amountCents: r.order?.amountCents ?? null,
      orderLifecycle: r.order?.lifecycle ?? null,
      paymentStatus: r.order?.payment_status ?? null,
      waitlistPosition: r.waitlistEntry?.position ?? null,
      waitlistStatus: r.waitlistEntry?.status ?? null,
      waitlistOfferExpiresAt: r.waitlistEntry?.offerExpiresAt ?? null,
      ended,
      canReview: ended || r.status === "checked_in",
      canCancel,
      createdAt: r.createdAt,
    };
  });
}

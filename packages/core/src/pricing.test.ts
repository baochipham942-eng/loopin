import { describe, it, expect } from "vitest";
import { effectiveTicketPriceCents } from "./pricing.js";

const before = new Date("2026-06-01T00:00:00Z");
const after = new Date("2026-07-01T00:00:00Z");
const until = "2026-06-15T00:00:00Z";

describe("effectiveTicketPriceCents", () => {
  it("无早鸟配置用原价", () => {
    expect(effectiveTicketPriceCents({ priceCents: 19900 }, before)).toBe(19900);
  });
  it("早鸟截止前用早鸟价", () => {
    expect(effectiveTicketPriceCents({ priceCents: 19900, earlyBirdPriceCents: 9900, earlyBirdUntil: until }, before)).toBe(9900);
  });
  it("早鸟截止后回到原价", () => {
    expect(effectiveTicketPriceCents({ priceCents: 19900, earlyBirdPriceCents: 9900, earlyBirdUntil: until }, after)).toBe(19900);
  });
  it("只有早鸟价没截止时间用原价", () => {
    expect(effectiveTicketPriceCents({ priceCents: 19900, earlyBirdPriceCents: 9900 }, before)).toBe(19900);
  });
});

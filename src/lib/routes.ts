/**
 * Per-account addresses. The id in the URL names the account for people
 * reading the address bar; it is never trusted for access (the signed session
 * decides who you are, and pages 404 when the two disagree).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string | undefined | null): s is string => typeof s === "string" && UUID.test(s);

const join = (base: string, sub: string) => (sub ? `${base}/${sub.replace(/^\/+/, "")}` : base);

export const sellerPath = (sellerId: string, sub = "") => join(`/seller/${sellerId}`, sub);
export const buyerPath = (buyerId: string, sub = "") => join(`/buyer/${buyerId}`, sub);

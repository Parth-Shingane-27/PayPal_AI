import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { handler } from "@/server/http";

export const POST = handler(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});

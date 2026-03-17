import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const SESSION_COOKIE = "sf_admin_session";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  createSessionToken,
  passwordMatches,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(request: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: { message: "Set ADMIN_PASSWORD in .env.local before using the admin." } },
      { status: 503 },
    );
  }

  let password = "";
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { password?: unknown };
      password = typeof body.password === "string" ? body.password : "";
    } else {
      const form = await request.formData();
      password = String(form.get("password") ?? "");
    }
  } catch {
    password = "";
  }

  if (!password || !passwordMatches(password)) {
    return NextResponse.json(
      { error: { message: "That password is not correct." } },
      { status: 401 },
    );
  }

  const token = await createSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: { message: "Admin session signing is not configured." } },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, token, sessionCookieOptions());
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, isOwnerEmail, normalizeUserEmail } from "@/lib/identity";
import {
  USER_COOKIE,
  authenticatedEmail,
  createUserToken,
  dailyLimitFor,
  userCookieOptions,
} from "@/lib/user-auth";

const NO_STORE = { "Cache-Control": "no-store" };

/** Current email session, used by the sign-in gate. */
export async function GET(request: NextRequest) {
  const email = await authenticatedEmail(request);
  if (!email) {
    return NextResponse.json(
      { authenticated: false, error: { message: "Enter your email to continue." } },
      { status: 401, headers: NO_STORE },
    );
  }

  const admin = await isAdminRequest(request);
  const owner = admin || isOwnerEmail(email);
  return NextResponse.json(
    {
      authenticated: true,
      email,
      owner,
      limit: dailyLimitFor(owner),
      dailyLimit: dailyLimitFor(owner),
    },
    { headers: NO_STORE },
  );
}

/** Sign in with an email address. No password is used on the public site. */
export async function POST(request: NextRequest) {
  let email = "";
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { email?: unknown };
      email = typeof body.email === "string" ? body.email : "";
    } else {
      const form = await request.formData();
      email = String(form.get("email") ?? "");
    }
  } catch {
    email = "";
  }

  const normalized = normalizeUserEmail(email);
  if (!normalized) {
    return NextResponse.json(
      { error: { message: "Enter a valid email address." } },
      { status: 400, headers: NO_STORE },
    );
  }

  const token = await createUserToken(normalized);
  if (!token) {
    return NextResponse.json(
      {
        error: {
          message:
            "Email sign-in is not configured. Set ADMIN_PASSWORD or ADMIN_SESSION_SECRET on the server.",
        },
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const admin = await isAdminRequest(request);
  const owner = admin || isOwnerEmail(normalized);
  const response = NextResponse.json(
    {
      authenticated: true,
      email: normalized,
      owner,
      limit: dailyLimitFor(owner),
      dailyLimit: dailyLimitFor(owner),
    },
    { headers: NO_STORE },
  );
  response.cookies.set(USER_COOKIE, token, userCookieOptions());
  return response;
}

/** Sign out and show the email modal again. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.cookies.set(USER_COOKIE, "", { ...userCookieOptions(), maxAge: 0 });
  return response;
}

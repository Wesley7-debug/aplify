import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, normalizeUserEmail } from "@/lib/identity";
import {
  USER_COOKIE,
  USER_DAILY_LIMIT,
  authenticatedEmail,
  createUserToken,
  ensureDeviceCookie,
  searchLimitFor,
  userCookieOptions,
} from "@/lib/user-auth";

const NO_STORE = { "Cache-Control": "no-store" };

/** Current email session, used by the sign-in gate. */
export async function GET(request: NextRequest) {
  const email = await authenticatedEmail(request);
  const admin = await isAdminRequest(request);

  if (!email) {
    const response = NextResponse.json(
      { authenticated: false, error: { message: "Enter your email to continue." } },
      { status: 401, headers: NO_STORE },
    );
    ensureDeviceCookie(request, response);
    return response;
  }

  const response = NextResponse.json(
    {
      authenticated: true,
      email,
      owner: admin,
      limit: searchLimitFor(admin),
      dailyLimit: admin ? null : USER_DAILY_LIMIT,
    },
    { headers: NO_STORE },
  );
  ensureDeviceCookie(request, response);
  return response;
}

/** Sign in with an email address. Admin privileges require the /admin login. */
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
    const response = NextResponse.json(
      { error: { message: "Enter a valid email address." } },
      { status: 400, headers: NO_STORE },
    );
    ensureDeviceCookie(request, response);
    return response;
  }

  const token = await createUserToken(normalized);
  if (!token) {
    const response = NextResponse.json(
      {
        error: {
          message:
            "Email sign-in is not configured. Set ADMIN_PASSWORD or ADMIN_SESSION_SECRET on the server.",
        },
      },
      { status: 503, headers: NO_STORE },
    );
    ensureDeviceCookie(request, response);
    return response;
  }

  const admin = await isAdminRequest(request);
  const response = NextResponse.json(
    {
      authenticated: true,
      email: normalized,
      owner: admin,
      limit: searchLimitFor(admin),
      dailyLimit: admin ? null : USER_DAILY_LIMIT,
    },
    { headers: NO_STORE },
  );
  response.cookies.set(USER_COOKIE, token, userCookieOptions());
  ensureDeviceCookie(request, response);
  return response;
}

/** Sign out and show the email modal again. The device limit is not reset. */
export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.cookies.set(USER_COOKIE, "", { ...userCookieOptions(), maxAge: 0 });
  ensureDeviceCookie(request, response);
  return response;
}

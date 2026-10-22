import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Next.js 16 proxy (the renamed middleware convention).
 * Blocks everything under /admin and /api/admin except the login endpoints.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api/admin/login") return NextResponse.next();

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const authenticated = await verifySessionToken(token);

  if (pathname === "/admin/login") {
    if (authenticated) return NextResponse.redirect(new URL("/admin", request.url));
    return NextResponse.next();
  }

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json(
      { error: { message: "Admin authentication required." } },
      { status: 401 },
    );
  }

  const login = new URL("/admin/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};

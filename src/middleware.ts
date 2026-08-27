import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Protects all app routes except auth pages, marketing/root, and API auth
 * routes. Authorization for *which* resources a signed-in user can reach
 * (workspace/group membership, role) still happens server-side per request
 * — this middleware only enforces "must be signed in at all".
 */
export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/sign-in",
    },
  }
);

export const config = {
  matcher: [
    "/home",
    "/subjects/:path*",
    "/groups/:path*",
    "/materials/:path*",
    "/assistant/:path*",
    "/search/:path*",
    "/settings/:path*",
    "/onboarding",
    "/api/subjects/:path*",
    "/api/chapters/:path*",
    "/api/topics/:path*",
    "/api/notes/:path*",
    "/api/materials/:path*",
    "/api/groups/:path*",
    "/api/ai/:path*",
  ],
};

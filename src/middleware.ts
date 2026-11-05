import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Protects all app routes except auth pages, marketing/root, and API auth
 * routes. Authorization for *which* resources a signed-in user can reach
 * (workspace/group membership, role) still happens server-side per request
 * — this middleware only enforces "must be signed in at all".
 */
export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    if (req.nextUrl.pathname.startsWith("/api/") && !req.nextauth.token) {
      return NextResponse.json({ error: "You need to sign in to do that." }, { status: 401 });
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        if (req.nextUrl.pathname.startsWith("/api/")) {
          return true;
        }
        return !!token;
      },
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
    "/flashcards/:path*",
    "/quizzes/:path*",
    "/api/subjects/:path*",
    "/api/chapters/:path*",
    "/api/topics/:path*",
    "/api/notes/:path*",
    "/api/materials/:path*",
    "/api/groups/:path*",
    "/api/ai/:path*",
    "/api/flashcards/:path*",
    "/api/quizzes/:path*",
    "/api/progress",
    "/api/recording-usage",
  ],
};

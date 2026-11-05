import { beforeAll, describe, expect, it } from "vitest";

const SECRET = "test-secret-at-least-32-chars-long-123456";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";
});

import middleware, { config } from "@/middleware";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";

describe("middleware configuration and coverage", () => {
  it("includes all required protected page and API routes in matcher", () => {
    const requiredRoutes = [
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
    ];

    for (const route of requiredRoutes) {
      expect(config.matcher).toContain(route);
    }
  });

  it("does not match public routes in matcher", () => {
    const publicRoutes = [
      "/",
      "/welcome",
      "/welcome/intro",
      "/sign-in",
      "/sign-up",
      "/api/auth/register",
      "/api/health",
      "/api/client-errors",
    ];

    for (const route of publicRoutes) {
      expect(config.matcher).not.toContain(route);
    }
  });
});

describe("middleware execution behavior", () => {
  async function makeNextRequest(url: string, tokenPayload: Record<string, unknown> | null = null): Promise<NextRequest> {
    const headers = new Headers();
    if (tokenPayload) {
      const encoded = await encode({
        token: tokenPayload,
        secret: SECRET,
        maxAge: 3600,
      });
      headers.set("cookie", `next-auth.session-token=${encoded}`);
    }
    return new NextRequest(new URL(url, "http://127.0.0.1:3000"), { headers });
  }

  it("redirects unauthenticated page requests to /sign-in with callbackUrl", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/flashcards/deck-123", null);
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/sign-in");
    expect(location).toContain("callbackUrl=%2Fflashcards%2Fdeck-123");
  });

  it("redirects unauthenticated quiz page requests to /sign-in", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/quizzes/quiz-456", null);
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/sign-in");
    expect(location).toContain("callbackUrl=%2Fquizzes%2Fquiz-456");
  });

  it("returns 401 JSON response for unauthenticated /api/flashcards requests", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/api/flashcards/deck-123", null);
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "You need to sign in to do that." });
  });

  it("returns 401 JSON response for unauthenticated /api/quizzes requests", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/api/quizzes/quiz-456", null);
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "You need to sign in to do that." });
  });

  it("returns 401 JSON response for unauthenticated /api/progress requests", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/api/progress", null);
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "You need to sign in to do that." });
  });

  it("returns 401 JSON response for unauthenticated /api/recording-usage requests", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/api/recording-usage", null);
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "You need to sign in to do that." });
  });

  it("allows authenticated page requests through with NextResponse.next()", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/flashcards/deck-123", { sub: "user-1" });
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows authenticated API requests through with NextResponse.next()", async () => {
    const req = await makeNextRequest("http://127.0.0.1:3000/api/flashcards/deck-123", { sub: "user-1" });
    const res = await (middleware as any)(req);

    expect(res).toBeDefined();
    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});

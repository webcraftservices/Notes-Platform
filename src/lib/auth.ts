import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signInSchema } from "@/lib/validation/auth";
import { provisionNewUser } from "@/lib/provision";

/**
 * Central NextAuth config, shared by the [...nextauth] route handler and
 * any server-side `getServerSession(authOptions)` call.
 *
 * Auth strategy: JWT sessions (not database sessions) so API routes and
 * middleware can authorize requests without a DB round trip on every call.
 * The Prisma adapter still persists Account/Session rows for OAuth linking
 * and audit purposes.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    newUser: "/onboarding",
    error: "/sign-in",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // Only sign-in scopes here. Drive/Docs scopes (spec §29-30) are
      // requested separately via the Connected Accounts flow, not at
      // login, so users aren't asked for broad file access just to sign in.
      authorization: {
        params: { prompt: "consent", access_type: "offline", response_type: "code" },
      },
    }),
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  events: {
    // Fires only for OAuth (Google) signups — the Credentials provider has
    // no concept of "new user" in NextAuth, so email/password provisioning
    // happens explicitly in /api/auth/register instead. Both paths call the
    // same provisionNewUser() so the two never drift apart.
    async createUser({ user }) {
      await provisionNewUser(user.id);
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

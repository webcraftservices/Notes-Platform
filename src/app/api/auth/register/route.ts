import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { rateLimit } from "@/lib/rate-limit";
import { provisionNewUser } from "@/lib/provision";

export async function POST(req: Request) {
  // Registration is a prime abuse target — rate limit by IP before touching the DB.
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await rateLimit(`register:${ip}`, { limit: 5, windowSeconds: 60 * 15 });
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  // Exact match lookup on normalized email, with case-insensitive fallback
  // for compatibility with legacy accounts created before normalization was enforced.
  let existing = await db.user.findUnique({ where: { email } });
  if (!existing) {
    existing = await db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }

  if (existing) {
    // Deliberately vague — do not reveal whether an email is registered.
    return NextResponse.json(
      { error: "Could not create account with these details." },
      { status: 409 }
    );
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { name, email, passwordHash },
        select: { id: true, email: true, name: true },
      });

      await provisionNewUser(newUser.id, tx);

      return newUser;
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err: unknown) {
    // Handle Prisma unique constraint violation (P2002) in race conditions
    if (
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") ||
      (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002")
    ) {
      return NextResponse.json(
        { error: "Could not create account with these details." },
        { status: 409 }
      );
    }
    console.error("[register] failed to create user:", err);
    return NextResponse.json(
      { error: "Could not create account with these details." },
      { status: 500 }
    );
  }
}

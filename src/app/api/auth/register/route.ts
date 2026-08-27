import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
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

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Deliberately vague — do not reveal whether an email is registered.
    return NextResponse.json(
      { error: "Could not create account with these details." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.user.create({
    data: { name, email, passwordHash },
    select: { id: true, email: true, name: true },
  });

  await provisionNewUser(user.id);

  return NextResponse.json({ user }, { status: 201 });
}

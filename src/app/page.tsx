import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function RootPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/sign-in");

  const profile = await db.profile.findUnique({ where: { userId: session.user.id } });
  redirect(profile?.onboardedAt ? "/home" : "/onboarding");
}

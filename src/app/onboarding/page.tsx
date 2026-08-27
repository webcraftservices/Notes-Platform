import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/sign-in");

  const profile = await db.profile.findUnique({ where: { userId: session.user.id } });
  if (profile?.onboardedAt) redirect("/home");

  return <OnboardingFlow />;
}

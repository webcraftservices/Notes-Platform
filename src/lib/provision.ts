import { db } from "@/lib/db";
import { nanoid } from "nanoid";

/**
 * Everything a brand-new account needs before it can use the app, in one
 * place so the OAuth signup path (NextAuth's createUser event) and the
 * email/password signup path (/api/auth/register) can't drift apart.
 *
 * Every account gets exactly one personal Workspace at signup — see
 * `getPrimaryWorkspace` in lib/access.ts for the "one workspace per user"
 * assumption this satisfies.
 */
export async function provisionNewUser(userId: string) {
  await db.$transaction(async (tx) => {
    await tx.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    await tx.subscription.upsert({
      where: { userId },
      update: {},
      create: { userId, plan: "FREE" },
    });

    const existingWorkspace = await tx.workspaceMember.findFirst({ where: { userId } });
    if (!existingWorkspace) {
      await tx.workspace.create({
        data: {
          name: "My Workspace",
          slug: `ws-${nanoid(10)}`,
          ownerId: userId,
          mode: "STUDY",
          members: { create: { userId, role: "OWNER" } },
        },
      });
    }
  });
}

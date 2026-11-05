import { db } from "@/lib/db";
import { nanoid } from "nanoid";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Everything a brand-new account needs before it can use the app, in one
 * place so the OAuth signup path (NextAuth's createUser event) and the
 * email/password signup path (/api/auth/register) can't drift apart.
 *
 * Every account gets exactly one personal Workspace at signup — see
 * `getPrimaryWorkspace` in lib/access.ts for the "one workspace per user"
 * assumption this satisfies.
 *
 * Accepts an optional transaction client `tx` so callers that already run
 * inside a `db.$transaction` (like `/api/auth/register`) can keep user
 * creation and provisioning strictly atomic without nested transactions.
 */
export async function provisionNewUser(userId: string, tx?: DbOrTx) {
  if (tx) {
    await runProvisioning(tx, userId);
  } else {
    await db.$transaction(async (innerTx) => {
      await runProvisioning(innerTx, userId);
    });
  }
}

async function runProvisioning(tx: DbOrTx, userId: string) {
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
}

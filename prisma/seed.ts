import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123", 12);

  const user = await db.user.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      email: "demo@example.com",
      name: "Demo User",
      passwordHash,
    },
  });

  await db.profile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, onboardedAt: new Date(), usageIntent: "STUDY" },
  });

  await db.subscription.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, plan: "STUDENT" },
  });

  const workspace = await db.workspace.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      ownerId: user.id,
      mode: "STUDY",
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const existingSubjects = await db.subject.count({ where: { workspaceId: workspace.id } });
  if (existingSubjects === 0) {
    const physics = await db.subject.create({
      data: {
        workspaceId: workspace.id,
        name: "Physics",
        description: "Core undergraduate physics",
        icon: "atom",
        color: "indigo",
      },
    });

    const thermo = await db.chapter.create({
      data: { subjectId: physics.id, name: "Thermodynamics", order: 0, status: "IN_PROGRESS" },
    });
    await db.topic.createMany({
      data: [
        { chapterId: thermo.id, name: "Thermal Equilibrium", order: 0 },
        { chapterId: thermo.id, name: "Zeroth Law", order: 1 },
        { chapterId: thermo.id, name: "Temperature", order: 2 },
      ],
    });

    const mechanics = await db.chapter.create({
      data: { subjectId: physics.id, name: "Classical Mechanics", order: 1, status: "COMPLETED" },
    });
    await db.topic.createMany({
      data: [{ chapterId: mechanics.id, name: "Newton's Laws", order: 0 }],
    });

    const calc = await db.subject.create({
      data: {
        workspaceId: workspace.id,
        name: "Calculus",
        description: "Differential and integral calculus",
        icon: "calculator",
        color: "amber",
      },
    });
    await db.chapter.create({
      data: { subjectId: calc.id, name: "Limits and Continuity", order: 0, status: "NOT_STARTED" },
    });
  }

  console.log("Seeded demo user: demo@example.com / Password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

import { requireUser, getPrimaryWorkspace } from "@/lib/access";
import { db } from "@/lib/db";
import { getPlanLimits } from "@/lib/plans";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNavDrawer } from "@/components/shell/mobile-nav-drawer";
import { CommandPaletteProvider } from "@/components/shell/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const workspace = await getPrimaryWorkspace(user.id);
  const subscription = await db.subscription.findUnique({ where: { userId: user.id } });
  const plan = getPlanLimits(subscription?.plan ?? "FREE");

  const shellProps = {
    userName: user.name ?? null,
    userEmail: user.email ?? "",
    userImage: user.image ?? null,
    workspaceName: workspace.name,
    planLabel: plan.label,
  };

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-paper dark:bg-graphite-950">
        <Sidebar {...shellProps} />
        <MobileNavDrawer {...shellProps} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </CommandPaletteProvider>
  );
}

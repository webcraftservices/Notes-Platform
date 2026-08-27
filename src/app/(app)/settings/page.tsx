import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import { getPlanLimits } from "@/lib/plans";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { SettingsForm } from "@/components/settings/settings-form";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default async function SettingsPage() {
  const user = await requireUser();
  const [profile, subscription] = await Promise.all([
    db.profile.findUniqueOrThrow({ where: { userId: user.id } }),
    db.subscription.findUniqueOrThrow({ where: { userId: user.id } }),
  ]);
  const plan = getPlanLimits(subscription.plan);

  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Settings" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-xl space-y-10">
          <div>
            <h1 className="font-display text-xl font-semibold text-ink dark:text-white">Settings</h1>
            <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
              Manage your profile and preferences.
            </p>
          </div>

          <SettingsForm
            name={user.name ?? ""}
            email={user.email ?? ""}
            theme={profile.theme}
          />

          <section className="card p-5">
            <h2 className="font-display text-sm font-semibold text-ink dark:text-white">Plan</h2>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-ink-muted dark:text-white/50">Current plan</span>
              <span className="font-medium text-ink dark:text-white">{plan.label}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-ink-muted dark:text-white/50">AI credits / month</span>
              <span className="font-medium text-ink dark:text-white">{plan.aiCreditsPerMonth.toLocaleString()}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-ink-muted dark:text-white/50">Recording minutes / month</span>
              <span className="font-medium text-ink dark:text-white">{plan.recordingMinutesPerMonth.toLocaleString()}</span>
            </div>
            <p className="mt-4 text-xs text-ink-faint dark:text-white/30">
              Upgrades and billing arrive in Phase 9 alongside usage tracking.
            </p>
          </section>

          <section className="card p-5">
            <h2 className="font-display text-sm font-semibold text-ink dark:text-white">Session</h2>
            <p className="mt-1 mb-4 text-sm text-ink-muted dark:text-white/50">
              Signed in as {user.email}
            </p>
            <SignOutButton />
          </section>
        </div>
      </main>
    </>
  );
}

import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import { getUserBillingSummary } from "@/lib/billing/stripe";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { SettingsForm } from "@/components/settings/settings-form";
import { ConnectedAccountsPanel } from "@/components/settings/connected-accounts-panel";
import { BillingPanel } from "@/components/settings/billing-panel";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default async function SettingsPage() {
  const user = await requireUser();
  const [profile, billingSummary] = await Promise.all([
    db.profile.findUniqueOrThrow({ where: { userId: user.id } }),
    getUserBillingSummary(user.id),
  ]);

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

          <ConnectedAccountsPanel />

          <BillingPanel initialSummary={billingSummary} />

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

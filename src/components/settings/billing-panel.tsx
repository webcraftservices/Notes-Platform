"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, ExternalLink, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserBillingSummary } from "@/lib/billing/stripe";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function BillingPanel({ initialSummary }: { initialSummary: UserBillingSummary }) {
  const [summary] = useState<UserBillingSummary>(initialSummary);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const { subscription, usage, availablePlans, stripeConfigured } = summary;

  async function handleCheckout(planTier: string) {
    setLoadingPlan(planTier);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planTier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        toast.error(data?.error ?? "Unable to start Stripe checkout.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      toast.error("Unable to start Stripe checkout.");
    } finally {
      setLoadingPlan(null);
    }
  }

  async function handlePortal() {
    setOpeningPortal(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        toast.error(data?.error ?? "Unable to open Stripe billing portal.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      toast.error("Unable to open Stripe billing portal.");
    } finally {
      setOpeningPortal(false);
    }
  }

  const statusBadgeColor =
    subscription.status === "ACTIVE" || subscription.status === "TRIALING"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : subscription.status === "PAST_DUE"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-zinc-500/10 text-ink-muted dark:text-white/60";

  return (
    <section className="card p-5 space-y-6" data-testid="billing-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-ink-muted dark:text-white/60" />
            <h2 className="font-display text-sm font-semibold text-ink dark:text-white">
              Plan &amp; Billing
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted dark:text-white/50">
            Manage your subscription tier, monthly AI credits, and storage quota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-ink dark:bg-graphite-800 dark:text-white">
            {subscription.planLabel}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeColor}`}>
            {subscription.status}
          </span>
        </div>
      </div>

      {subscription.status === "PAST_DUE" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Your most recent subscription payment is past due. Open the billing portal to update your payment method.
          </span>
        </div>
      )}

      {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink-muted dark:border-line-dark dark:bg-graphite-800 dark:text-white/70">
          Your subscription is scheduled to cancel at the end of the current period (
          {new Date(subscription.currentPeriodEnd).toLocaleDateString()}).
        </div>
      )}

      {/* Real-time Quota Usage Bars */}
      <div className="space-y-3 border-t border-line pt-4 dark:border-line-dark">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted dark:text-white/60">AI Credits (monthly)</span>
            <span className="font-mono text-ink dark:text-white">
              {usage.ai.usedCredits.toLocaleString()} / {usage.ai.limitCredits.toLocaleString()} ({usage.ai.percentUsed}%)
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
            <div
              className="h-full rounded-full bg-ink transition-all dark:bg-white"
              style={{ width: `${Math.min(100, usage.ai.percentUsed)}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted dark:text-white/60">Cloud Storage</span>
            <span className="font-mono text-ink dark:text-white">
              {formatBytes(usage.storage.usedBytes)} / {formatBytes(usage.storage.limitBytes)} ({usage.storage.percentUsed}%)
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
            <div
              className="h-full rounded-full bg-ink transition-all dark:bg-white"
              style={{ width: `${Math.min(100, usage.storage.percentUsed)}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted dark:text-white/60">Recording Minutes (monthly)</span>
            <span className="font-mono text-ink dark:text-white">
              {usage.recording.usedMinutes.toLocaleString()} / {usage.recording.limitMinutes.toLocaleString()} min ({usage.recording.percentUsed}%)
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
            <div
              className="h-full rounded-full bg-ink transition-all dark:bg-white"
              style={{ width: `${Math.min(100, usage.recording.percentUsed)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Plan Upgrade / Portal Controls */}
      <div className="space-y-3 border-t border-line pt-4 dark:border-line-dark">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint dark:text-white/40">
            Available Plans
          </h3>
          {subscription.hasBillingCustomer && (
            <Button
              variant="secondary"
              loading={openingPortal}
              disabled={!stripeConfigured}
              onClick={handlePortal}
            >
              Manage Billing
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {availablePlans
            .filter((p) => p.tier === "STUDENT" || p.tier === "PRO" || p.tier === "TEAM")
            .map((planOption) => {
              const isCurrent = subscription.plan === planOption.tier;
              return (
                <div
                  key={planOption.tier}
                  className="flex flex-col justify-between rounded-lg border border-line p-3 dark:border-line-dark"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-ink dark:text-white">
                        {planOption.label}
                      </span>
                      <span className="font-mono text-xs text-ink-muted dark:text-white/60">
                        {planOption.intervalLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted dark:text-white/50">
                      {planOption.description}
                    </p>
                  </div>
                  <div className="mt-3">
                    {isCurrent ? (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Current Plan
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        className="w-full"
                        loading={loadingPlan === planOption.tier}
                        disabled={!planOption.checkoutAvailable}
                        onClick={() => handleCheckout(planOption.tier)}
                      >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        {planOption.checkoutAvailable
                          ? `Upgrade to ${planOption.label}`
                          : `${planOption.label} (Stripe unconfigured)`}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {!stripeConfigured && (
          <p className="text-xs text-ink-faint dark:text-white/30">
            Stripe API credentials are not configured in this environment. Server-side plan quotas and entitlements remain active.
          </p>
        )}
      </div>
    </section>
  );
}

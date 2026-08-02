// Lyfos plans + entitlements.
//
// Single source of truth for what each plan can do. Both the client
// (for showing/hiding UI) and the server (via current_plan_for() +
// the key_shares trigger) read from this shape.
//
// Pricing is INR primary. amountUsd is for the Stripe path that
// activates only when STRIPE secrets are configured.

export const PLANS = {
  free: {
    id: "free",
    label: "Free Forever",
    amountInr: 0,
    amountUsd: 0,
    interval: "year",
    vaultItemLimit: 11,
    keyHolderLimit: 0,
    balanceSheetEnabled: false,
    releaseEnabled: false,
    summary: "A private starter vault for 11 important entries.",
    bullets: [
      "Up to 11 vault entries",
      "Encrypted backup + multi-device sync",
      "Recovery phrase",
      "No personal balance sheet",
      "No Circle of Trust release service"
    ]
  },
  vault: {
    id: "vault",
    label: "Vault",
    amountInr: 99900,    // 999 INR in paise
    amountUsd: 900,       // $9 USD in cents
    interval: "year",
    launchState: "coming_fall",
    checkoutEnabled: false,
    vaultItemLimit: Infinity,
    keyHolderLimit: 5,
    balanceSheetEnabled: true,
    releaseEnabled: true,
    summary: "Unlimited family vault with balance sheet and release.",
    bullets: [
      "Unlimited vault entries",
      "Personal balance sheet",
      "Circle of Trust with 5 nominees/key holders",
      "Primary or backup recipient + 2 supporting nominees",
      "Invite emails and release alerts"
    ]
  }
};

export function planFor(planId) {
  return PLANS[planId] ?? PLANS.free;
}

export function isPaid(planId) {
  return planId === "vault";
}

export function paidPlans() {
  return [PLANS.vault];
}

/**
 * Read the entitlements for a user's current subscription row.
 * Treats past_due as still-entitled until grace_until passes (defaults
 * to 7 days from subscription's current_period_end).
 */
export function entitlementsFor(subscription) {
  if (!subscription) return { ...planFor("free"), effective: "free", source: "no_subscription" };

  const requestedPlanId = subscription.plan ?? "free";
  const planId = isPaid(requestedPlanId) ? requestedPlanId : "free";
  const status = subscription.status ?? "active";
  const plan   = planFor(planId);

  // Active or trialing → full plan entitlements
  if (status === "active" || status === "trialing") {
    return { ...plan, effective: planId, source: status };
  }

  // Past due → still entitled until grace_until
  if (status === "past_due") {
    const gracePassed = subscription.grace_until
      ? new Date(subscription.grace_until).getTime() < Date.now()
      : false;
    if (gracePassed) return { ...planFor("free"), effective: "free", source: "grace_expired" };
    return { ...plan, effective: planId, source: "past_due_in_grace" };
  }

  // Cancelled / expired → free
  return { ...planFor("free"), effective: "free", source: status };
}

/** Number of days left in current period (or in grace if past_due). */
export function daysLeftFor(subscription) {
  if (!subscription) return null;
  const target = subscription.status === "past_due"
    ? subscription.grace_until
    : subscription.current_period_end;
  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - Date.now()) / 86_400_000));
}

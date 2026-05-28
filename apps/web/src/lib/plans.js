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
    label: "Free",
    amountInr: 0,
    amountUsd: 0,
    interval: "year",
    vaultItemLimit: 10,
    keyHolderLimit: 0,
    releaseEnabled: false,
    summary: "Balance sheet + up to 10 vault records.",
    bullets: [
      "Net worth + balance sheet, every feature",
      "Up to 10 vault records",
      "Encrypted backup + multi-device sync",
      "No release service — for that, upgrade"
    ]
  },
  vault: {
    id: "vault",
    label: "Vault",
    amountInr: 99900,    // 999 INR in paise
    amountUsd: 1500,      // $15 USD in cents
    interval: "year",
    vaultItemLimit: Infinity,
    keyHolderLimit: 5,
    releaseEnabled: true,
    summary: "Unlimited vault + real release service.",
    bullets: [
      "Unlimited vault records",
      "5 verified key holders",
      "Real release engine with 14-day owner hold",
      "Multi-channel alerts (email + SMS + WhatsApp)",
      "Annual death-drill reminder"
    ]
  },
  family: {
    id: "family",
    label: "Family",
    amountInr: 249900,   // 2499 INR in paise
    amountUsd: 4500,
    interval: "year",
    vaultItemLimit: Infinity,
    keyHolderLimit: 5,
    releaseEnabled: true,
    summary: "Up to 4 vaults under one account.",
    bullets: [
      "Up to 4 vaults (you, spouse, parents)",
      "Each vault: unlimited records + full release",
      "Shared key holders across vaults if you want",
      "Annual coordinated review with all members"
    ]
  }
};

export function planFor(planId) {
  return PLANS[planId] ?? PLANS.free;
}

export function isPaid(planId) {
  return planId === "vault" || planId === "family";
}

/**
 * Read the entitlements for a user's current subscription row.
 * Treats past_due as still-entitled until grace_until passes (defaults
 * to 7 days from subscription's current_period_end).
 */
export function entitlementsFor(subscription) {
  if (!subscription) return { ...planFor("free"), effective: "free", source: "no_subscription" };

  const planId = subscription.plan ?? "free";
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

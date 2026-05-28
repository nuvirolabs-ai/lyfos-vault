// Plans + entitlements — mirror of apps/web/src/lib/plans.js.

export const PLANS = {
  free: {
    id: "free", label: "Free", amountInr: 0, amountUsd: 0, interval: "year",
    vaultItemLimit: 10, keyHolderLimit: 0, releaseEnabled: false,
    summary: "Balance sheet + up to 10 vault records.",
    bullets: [
      "Net worth + balance sheet, every feature",
      "Up to 10 vault records",
      "Encrypted backup + multi-device sync",
      "No release service — for that, upgrade"
    ]
  },
  vault: {
    id: "vault", label: "Vault", amountInr: 99900, amountUsd: 1500, interval: "year",
    vaultItemLimit: Infinity, keyHolderLimit: 5, releaseEnabled: true,
    summary: "Unlimited vault + real release service.",
    bullets: [
      "Unlimited vault records",
      "5 verified key holders",
      "Real release engine with 14-day owner hold",
      "Multi-channel alerts (email + SMS + WhatsApp + push)",
      "Annual death-drill reminder"
    ]
  },
  family: {
    id: "family", label: "Family", amountInr: 249900, amountUsd: 4500, interval: "year",
    vaultItemLimit: Infinity, keyHolderLimit: 5, releaseEnabled: true,
    summary: "Up to 4 vaults under one account.",
    bullets: [
      "Up to 4 vaults (you, spouse, parents)",
      "Each vault: unlimited records + full release",
      "Shared key holders across vaults if you want",
      "Annual coordinated review with all members"
    ]
  }
} as const;

export type PlanId = keyof typeof PLANS;

export function planFor(id: string): typeof PLANS.free {
  return (PLANS as any)[id] ?? PLANS.free;
}

export function isPaid(id: string): boolean { return id === "vault" || id === "family"; }

export function entitlementsFor(sub: any) {
  if (!sub) return { ...planFor("free"), effective: "free", source: "no_subscription" };
  const plan = planFor(sub.plan ?? "free");
  const status = sub.status ?? "active";
  if (status === "active" || status === "trialing") return { ...plan, effective: sub.plan, source: status };
  if (status === "past_due") {
    const gracePassed = sub.grace_until ? new Date(sub.grace_until).getTime() < Date.now() : false;
    if (gracePassed) return { ...planFor("free"), effective: "free", source: "grace_expired" };
    return { ...plan, effective: sub.plan, source: "past_due_in_grace" };
  }
  return { ...planFor("free"), effective: "free", source: status };
}

export function daysLeftFor(sub: any): number | null {
  if (!sub) return null;
  const target = sub.status === "past_due" ? sub.grace_until : sub.current_period_end;
  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - Date.now()) / 86_400_000));
}

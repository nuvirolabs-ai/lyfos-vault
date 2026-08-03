// Shared coupon lookup + discount math for the checkout Edge Functions.
//
// Redemption (writing to coupon_redemptions / bumping redemption_count)
// is NOT done here — that only happens in the Razorpay webhook once a
// payment is actually confirmed. This just validates a code and prices
// it, so it's safe to call speculatively from validate-coupon.

export type CouponResolution =
  | { ok: true; coupon: any; amountPaise: number; discountPaise: number }
  | { ok: false; error: string };

export async function resolveCoupon(
  admin: any,
  { code, plan, userId, amountPaise }: { code: string; plan: string; userId: string; amountPaise: number }
): Promise<CouponResolution> {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized) return { ok: false, error: "Enter a coupon code" };

  const { data: coupon, error } = await admin
    .from("coupons")
    .select("*")
    .eq("code", normalized)
    .eq("active", true)
    .maybeSingle();
  if (error) return { ok: false, error: "Could not check that code — try again" };
  if (!coupon) return { ok: false, error: "Invalid coupon code" };

  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This coupon has expired" };
  }
  if (coupon.plan && coupon.plan !== plan) {
    return { ok: false, error: "This coupon isn't valid for this plan" };
  }
  if (coupon.max_redemptions != null && coupon.redemption_count >= coupon.max_redemptions) {
    return { ok: false, error: "This coupon has reached its redemption limit" };
  }

  const { data: already } = await admin
    .from("coupon_redemptions")
    .select("id")
    .eq("coupon_id", coupon.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (already) return { ok: false, error: "You've already used this coupon" };

  const rawDiscount = coupon.discount_type === "percent"
    ? Math.round((amountPaise * coupon.discount_value) / 100)
    : coupon.discount_value;
  // Never discount below ₹1 (Razorpay's minimum payment amount).
  const discountPaise = Math.min(rawDiscount, Math.max(amountPaise - 100, 0));

  return { ok: true, coupon, amountPaise: amountPaise - discountPaise, discountPaise };
}

// Lyfos — create checkout session.
//
// Called by the client (authenticated user) to start an upgrade.
// Vault is a one-time purchase, not a recurring subscription: this
// creates a Razorpay Payment Link for the plan's amount (minus an
// optional coupon discount — see body.couponCode and _shared/coupons.ts)
// and returns its hosted checkout URL. The client redirects there; Razorpay's
// webhook (razorpay-webhook, on payment_link.paid) is what actually
// marks the purchase active once payment is confirmed — this
// function never marks anyone as upgraded itself.
//
// Required Edge Function secrets:
//   RAZORPAY_KEY_ID         (from API Keys page)
//   RAZORPAY_KEY_SECRET     (from API Keys page)
//   APP_URL                 (already set from Phase 2)
//
// Required Razorpay dashboard setup:
//   Configure a webhook at <project>.supabase.co/functions/v1/razorpay-webhook
//   subscribed to: payment_link.paid, payment.failed
//   Set a signing secret; pass it as RAZORPAY_WEBHOOK_SECRET.
//
// Optional Stripe:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_VAULT

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { corsPreflight, CORS_HEADERS } from "../_shared/cors.ts";
import { resolveCoupon } from "../_shared/coupons.ts";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const APP_URL      = Deno.env.get("APP_URL") ?? "https://app.lyfos.in";
// @ts-ignore
const PAID_LAUNCH_LOCKED = (Deno.env.get("PAID_LAUNCH_LOCKED") ?? "true") !== "false";

// @ts-ignore
const RZP_KEY      = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
// @ts-ignore
const RZP_SECRET   = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

// @ts-ignore
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
// @ts-ignore
const STRIPE_PRICE_VAULT  = Deno.env.get("STRIPE_PRICE_VAULT")  ?? "";

// One-time amounts, in the smallest currency unit — kept in sync with
// apps/web/src/lib/plans.js (PLANS.vault.amountInr / amountUsd).
const PLAN_AMOUNTS: Record<string, { inr: number; usd: number }> = {
  vault: { inr: 99900, usd: 900 }
};

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  if (PAID_LAUNCH_LOCKED) {
    return json({
      ok: false,
      error: "Vault launches this fall. Join the launch list instead."
    }, 423);
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "missing bearer" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: who, error: whoErr } = await admin.auth.getUser(auth.slice(7));
  if (whoErr || !who?.user?.id) return json({ ok: false, error: "invalid token" }, 401);
  const user = who.user;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const plan = body?.plan;
  const provider = body?.provider ?? "razorpay";
  const couponCode = body?.couponCode ? String(body.couponCode) : "";
  const amounts = PLAN_AMOUNTS[plan];
  if (!amounts) return json({ ok: false, error: "plan must be 'vault'" }, 400);

  // Reject if already purchased. Vault is a one-time lifetime purchase —
  // once 'active', there's nothing further to buy.
  const { data: existing } = await admin.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle();
  if (existing && existing.plan !== "free" && existing.status === "active") {
    return json({ ok: false, error: "already purchased", current: existing.plan }, 409);
  }

  let amountPaise = amounts.inr;
  let appliedCouponCode = "";
  let appliedDiscountPaise = 0;
  // Coupons only price the Razorpay Payment Link today — Stripe checkout
  // uses a fixed priceId and isn't discountable without a custom price.
  if (couponCode && provider === "razorpay") {
    const resolved = await resolveCoupon(admin, { code: couponCode, plan, userId: user.id, amountPaise: amounts.inr });
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 400);
    amountPaise = resolved.amountPaise;
    appliedCouponCode = resolved.coupon.code;
    appliedDiscountPaise = resolved.discountPaise;
  }

  if (provider === "razorpay") {
    if (!RZP_KEY || !RZP_SECRET) {
      return json({ ok: false, error: "razorpay not configured on this deployment" }, 503);
    }
    return await createRazorpayPaymentLink({ user, plan, amountPaise, couponCode: appliedCouponCode, discountPaise: appliedDiscountPaise });
  }

  if (provider === "stripe") {
    if (!STRIPE_KEY) {
      return json({ ok: false, error: "stripe not configured on this deployment" }, 503);
    }
    const priceId = STRIPE_PRICE_VAULT;
    if (!priceId) return json({ ok: false, error: "stripe price id missing for " + plan }, 503);
    return await createStripeSession({ user, plan, priceId });
  }

  return json({ ok: false, error: "unknown provider" }, 400);
});

// ============================================================
// Razorpay — one-time Payment Link
// ============================================================
async function createRazorpayPaymentLink({ user, plan, amountPaise, couponCode, discountPaise }: any) {
  const headers = {
    Authorization: "Basic " + btoa(`${RZP_KEY}:${RZP_SECRET}`),
    "content-type": "application/json"
  };

  const notes: Record<string, string> = { lyfos_user_id: user.id, lyfos_plan: plan };
  if (couponCode) {
    notes.lyfos_coupon_code = couponCode;
    notes.lyfos_discount_paise = String(discountPaise ?? 0);
  }

  const link = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers,
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      description: `Lyfos ${plan} — one-time, lifetime access`,
      customer: {
        name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Lyfos user",
        email: user.email
      },
      notify: { email: true, sms: false },
      reminder_enable: true,
      notes,
      callback_url: `${APP_URL}/?upgrade=success`,
      callback_method: "get"
    })
  });
  if (!link.ok) {
    const t = await link.text();
    return json({ ok: false, error: `razorpay payment link create failed: ${t.slice(0,200)}` }, 502);
  }
  const paymentLink = await link.json();

  return json({
    ok: true,
    provider: "razorpay",
    payment_link_id: paymentLink.id,
    checkoutUrl: paymentLink.short_url // hosted Razorpay checkout page
  });
}

// ============================================================
// Stripe (stub — wired but inactive without keys)
// ============================================================
async function createStripeSession({ user, plan, priceId }: any) {
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("customer_email", user.email ?? "");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${APP_URL}/?upgrade=success`);
  params.append("cancel_url",  `${APP_URL}/?upgrade=cancelled`);
  params.append("client_reference_id", user.id);
  params.append("payment_intent_data[metadata][lyfos_user_id]", user.id);
  params.append("payment_intent_data[metadata][lyfos_plan]", plan);

  const cr = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  if (!cr.ok) {
    const t = await cr.text();
    return json({ ok: false, error: `stripe session create failed: ${t.slice(0,200)}` }, 502);
  }
  const session = await cr.json();
  return json({ ok: true, provider: "stripe", checkoutUrl: session.url, session_id: session.id });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

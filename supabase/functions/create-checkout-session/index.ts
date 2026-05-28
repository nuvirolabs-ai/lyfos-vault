// Lyfos — create checkout session.
//
// Called by the client (authenticated user) to start an upgrade.
// Creates the provider-side subscription + customer if needed and
// returns a checkout URL the client redirects to. Razorpay is the
// primary provider; Stripe is wired up but only active when
// STRIPE_SECRET_KEY is set.
//
// Required Razorpay setup (one-time, in Razorpay dashboard):
//   1. Create two recurring Plans (Settings → Subscriptions → Plans):
//        - "Lyfos Vault yearly"  · amount 99900 paise  · period yearly
//        - "Lyfos Family yearly" · amount 249900 paise · period yearly
//      Note the plan IDs (plan_xxx).
//   2. Configure webhook: <project>.supabase.co/functions/v1/razorpay-webhook
//      Subscribe to: subscription.activated, subscription.charged,
//                    subscription.halted, subscription.cancelled,
//                    payment.failed
//      Set a webhook secret; pass it as RAZORPAY_WEBHOOK_SECRET.
//
// Required Edge Function secrets:
//   RAZORPAY_KEY_ID         (from API Keys page)
//   RAZORPAY_KEY_SECRET     (from API Keys page)
//   RAZORPAY_PLAN_VAULT     (plan_xxx for the Vault yearly plan)
//   RAZORPAY_PLAN_FAMILY    (plan_xxx for the Family yearly plan)
//   APP_URL                 (already set from Phase 2)
//
// Optional Stripe:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_VAULT
//   STRIPE_PRICE_FAMILY

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const APP_URL      = Deno.env.get("APP_URL") ?? "https://lyfos.signorvale.com";

// @ts-ignore
const RZP_KEY      = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
// @ts-ignore
const RZP_SECRET   = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
// @ts-ignore
const RZP_PLAN_VAULT  = Deno.env.get("RAZORPAY_PLAN_VAULT")  ?? "";
// @ts-ignore
const RZP_PLAN_FAMILY = Deno.env.get("RAZORPAY_PLAN_FAMILY") ?? "";

// @ts-ignore
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
// @ts-ignore
const STRIPE_PRICE_VAULT  = Deno.env.get("STRIPE_PRICE_VAULT")  ?? "";
// @ts-ignore
const STRIPE_PRICE_FAMILY = Deno.env.get("STRIPE_PRICE_FAMILY") ?? "";

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

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
  if (plan !== "vault" && plan !== "family") return json({ ok: false, error: "plan must be 'vault' or 'family'" }, 400);

  // Reject if already on a paid plan (active or trialing). We allow
  // upgrade from past_due so the user can fix payment.
  const { data: existing } = await admin.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle();
  if (existing && existing.plan !== "free" && ["active","trialing"].includes(existing.status)) {
    return json({ ok: false, error: "already subscribed", current: existing.plan }, 409);
  }

  if (provider === "razorpay") {
    if (!RZP_KEY || !RZP_SECRET) {
      return json({ ok: false, error: "razorpay not configured on this deployment" }, 503);
    }
    const planId = plan === "vault" ? RZP_PLAN_VAULT : RZP_PLAN_FAMILY;
    if (!planId) return json({ ok: false, error: "razorpay plan id missing for " + plan }, 503);
    return await createRazorpaySubscription({ admin, user, plan, planId });
  }

  if (provider === "stripe") {
    if (!STRIPE_KEY) {
      return json({ ok: false, error: "stripe not configured on this deployment" }, 503);
    }
    const priceId = plan === "vault" ? STRIPE_PRICE_VAULT : STRIPE_PRICE_FAMILY;
    if (!priceId) return json({ ok: false, error: "stripe price id missing for " + plan }, 503);
    return await createStripeSession({ admin, user, plan, priceId });
  }

  return json({ ok: false, error: "unknown provider" }, 400);
});

// ============================================================
// Razorpay
// ============================================================
async function createRazorpaySubscription({ admin, user, plan, planId }: any) {
  const headers = {
    Authorization: "Basic " + btoa(`${RZP_KEY}:${RZP_SECRET}`),
    "content-type": "application/json"
  };

  // Find or create a Razorpay customer linked to this user
  let customerId: string | null = null;
  const { data: subRow } = await admin.from("subscriptions").select("razorpay_customer_id").eq("user_id", user.id).maybeSingle();
  if (subRow?.razorpay_customer_id) customerId = subRow.razorpay_customer_id;

  if (!customerId) {
    const cr = await fetch("https://api.razorpay.com/v1/customers", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Lyfos user",
        email: user.email,
        fail_existing: "0" // re-use if email already a customer
      })
    });
    if (!cr.ok) {
      const t = await cr.text();
      return json({ ok: false, error: `razorpay customer create failed: ${t.slice(0,200)}` }, 502);
    }
    const c = await cr.json();
    customerId = c.id;
  }

  // Create the subscription
  const sub = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      plan_id: planId,
      customer_id: customerId,
      total_count: 60, // 60 yearly = 60 years max; we'd renew yearly via subscription.charged
      customer_notify: 1,
      notes: { lyfos_user_id: user.id, lyfos_plan: plan }
    })
  });
  if (!sub.ok) {
    const t = await sub.text();
    return json({ ok: false, error: `razorpay subscription create failed: ${t.slice(0,200)}` }, 502);
  }
  const subscription = await sub.json();

  // Optimistically insert a 'trialing' row — the webhook will flip it
  // to 'active' once Razorpay confirms first charge.
  await admin.from("subscriptions").upsert({
    user_id: user.id,
    plan,
    status: "trialing",
    provider: "razorpay",
    razorpay_customer_id: customerId,
    razorpay_subscription_id: subscription.id
  }, { onConflict: "user_id" });

  return json({
    ok: true,
    provider: "razorpay",
    subscription_id: subscription.id,
    checkoutUrl: subscription.short_url, // hosted Razorpay checkout page
    customer_id: customerId
  });
}

// ============================================================
// Stripe (stub — wired but inactive without keys)
// ============================================================
async function createStripeSession({ admin, user, plan, priceId }: any) {
  const params = new URLSearchParams();
  params.append("mode", "subscription");
  params.append("customer_email", user.email ?? "");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${APP_URL}/?upgrade=success`);
  params.append("cancel_url",  `${APP_URL}/?upgrade=cancelled`);
  params.append("client_reference_id", user.id);
  params.append("subscription_data[metadata][lyfos_user_id]", user.id);
  params.append("subscription_data[metadata][lyfos_plan]", plan);

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
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

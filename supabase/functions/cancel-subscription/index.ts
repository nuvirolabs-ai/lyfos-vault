// Lyfos — cancel-subscription Edge Function.
//
// Schedules a subscription to cancel at the end of the current period.
// Both Razorpay and Stripe support this natively. We flip
// cancel_at_period_end = true locally; the webhook flips status to
// 'cancelled' when the period actually ends.

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const RZP_KEY      = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
// @ts-ignore
const RZP_SECRET   = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
// @ts-ignore
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "missing bearer" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(auth.slice(7));
  if (!who?.user?.id) return json({ ok: false, error: "invalid token" }, 401);

  const { data: sub } = await admin.from("subscriptions").select("*").eq("user_id", who.user.id).maybeSingle();
  if (!sub) return json({ ok: false, error: "no active subscription" }, 404);

  if (sub.provider === "razorpay" && sub.razorpay_subscription_id) {
    if (!RZP_KEY || !RZP_SECRET) return json({ ok: false, error: "razorpay not configured" }, 503);
    const r = await fetch(`https://api.razorpay.com/v1/subscriptions/${sub.razorpay_subscription_id}/cancel`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${RZP_KEY}:${RZP_SECRET}`),
        "content-type": "application/json"
      },
      body: JSON.stringify({ cancel_at_cycle_end: 1 })
    });
    if (!r.ok) return json({ ok: false, error: `razorpay cancel failed: ${(await r.text()).slice(0,200)}` }, 502);
  } else if (sub.provider === "stripe" && sub.stripe_subscription_id) {
    if (!STRIPE_KEY) return json({ ok: false, error: "stripe not configured" }, 503);
    const params = new URLSearchParams();
    params.append("cancel_at_period_end", "true");
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    if (!r.ok) return json({ ok: false, error: `stripe cancel failed: ${(await r.text()).slice(0,200)}` }, 502);
  } else {
    return json({ ok: false, error: "no provider on this subscription" }, 400);
  }

  await admin.from("subscriptions").update({ cancel_at_period_end: true }).eq("user_id", who.user.id);
  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

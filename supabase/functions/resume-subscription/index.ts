// Lyfos — resume a subscription that was scheduled to cancel at
// period end. Razorpay doesn't have a direct "uncancel" if you used
// /cancel — you'd have to spin up a new subscription. So our resume
// only works for Stripe; for Razorpay we return a guided error.

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { corsPreflight, CORS_HEADERS } from "../_shared/cors.ts";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const STRIPE_KEY   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "missing bearer" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await admin.auth.getUser(auth.slice(7));
  if (!who?.user?.id) return json({ ok: false, error: "invalid token" }, 401);

  const { data: sub } = await admin.from("subscriptions").select("*").eq("user_id", who.user.id).maybeSingle();
  if (!sub) return json({ ok: false, error: "no subscription" }, 404);
  if (!sub.cancel_at_period_end) return json({ ok: false, error: "subscription is not pending cancellation" }, 400);

  if (sub.provider === "stripe" && sub.stripe_subscription_id && STRIPE_KEY) {
    const params = new URLSearchParams();
    params.append("cancel_at_period_end", "false");
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    if (!r.ok) return json({ ok: false, error: `stripe resume failed: ${(await r.text()).slice(0,200)}` }, 502);
    await admin.from("subscriptions").update({ cancel_at_period_end: false }).eq("user_id", who.user.id);
    return json({ ok: true });
  }

  if (sub.provider === "razorpay") {
    return json({
      ok: false,
      error: "Razorpay subscriptions cannot be un-cancelled. Start a new subscription before this one's current_period_end if you want to continue."
    }, 400);
  }

  return json({ ok: false, error: "no provider on this subscription" }, 400);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

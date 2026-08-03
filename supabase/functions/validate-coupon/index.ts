// Lyfos — validate a coupon code before checkout.
//
// Called by the client as the user types/applies a code on the billing
// page, so it can show the discounted price before redirecting to
// Razorpay. Doesn't reserve or redeem anything — create-checkout-session
// re-validates the same code when it actually creates the payment link,
// and the coupon is only marked redeemed once Razorpay confirms payment
// (see razorpay-webhook).
//
// Required Edge Function secrets: none beyond the project's own
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

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

// Kept in sync with apps/web/src/lib/plans.js (PLANS.vault.amountInr) and
// create-checkout-session/index.ts's PLAN_AMOUNTS.
const PLAN_AMOUNTS: Record<string, { inr: number }> = {
  vault: { inr: 99900 }
};

serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
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
  const code = body?.code;
  const amounts = PLAN_AMOUNTS[plan];
  if (!amounts) return json({ ok: false, error: "plan must be 'vault'" }, 400);

  const resolved = await resolveCoupon(admin, { code, plan, userId: user.id, amountPaise: amounts.inr });
  if (!resolved.ok) return json({ ok: false, error: resolved.error }, 200);

  return json({
    ok: true,
    code: resolved.coupon.code,
    originalAmountPaise: amounts.inr,
    discountPaise: resolved.discountPaise,
    amountPaise: resolved.amountPaise
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

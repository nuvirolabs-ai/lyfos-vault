// Lyfos — Razorpay webhook handler.
//
// Vault is a one-time purchase, not a recurring subscription. This
// listens for the Payment Link completing and marks the purchase
// 'active' with no expiry (current_period_end stays null — there is
// nothing to renew). Idempotent (de-dup by provider_event_id in
// billing_events).
//
// Validates the X-Razorpay-Signature header before doing anything.
//
// Events we listen for:
//   payment_link.paid — the one-time purchase succeeded; plan goes active
//   payment.failed     — log only, for support visibility
//
// Required secrets:
//   RAZORPAY_WEBHOOK_SECRET — set the same value in Razorpay dashboard

// @ts-ignore Deno
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
// @ts-ignore — Deno has SubtleCrypto on globalThis

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const WH_SECRET    = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);

  const raw = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!WH_SECRET) return text("RAZORPAY_WEBHOOK_SECRET not set", 503);

  const ok = await verifyHmacSha256(WH_SECRET, raw, sig);
  if (!ok) return text("signature invalid", 401);

  let body: any;
  try { body = JSON.parse(raw); } catch { return text("bad json", 400); }

  const eventType = body?.event;
  const eventId   = body?.id ?? body?.payload?.payment_link?.entity?.id ?? body?.payload?.payment?.entity?.id;

  // Idempotency: if we've seen this event before, ack.
  if (eventId) {
    const { data: dup } = await admin
      .from("billing_events")
      .select("id")
      .eq("provider", "razorpay")
      .eq("provider_event_id", eventId)
      .maybeSingle();
    if (dup) return text("ok (idempotent)", 200);
  }

  try {
    switch (eventType) {
      case "payment_link.paid":
        await handlePaymentLinkPaid(body, eventId);
        break;
      case "payment.failed":
        await handlePaymentFailed(body, eventId);
        break;
      default:
        // Log unhandled events so we can spot gaps without erroring.
        await logEvent(null, eventType, body, eventId, null);
    }
    return text("ok", 200);
  } catch (err: any) {
    console.warn("[lyfos] razorpay webhook error", err?.message);
    return text(`error: ${err?.message ?? "unknown"}`, 500);
  }
});

// ============================================================
// Handlers
// ============================================================

async function handlePaymentLinkPaid(body: any, eventId: string) {
  const link = body?.payload?.payment_link?.entity;
  const pay  = body?.payload?.payment?.entity;
  if (!link) return;
  const lyfosUserId = link?.notes?.lyfos_user_id;
  const lyfosPlan   = link?.notes?.lyfos_plan ?? "vault";
  if (!lyfosUserId) return;

  await admin.from("subscriptions").upsert({
    user_id: lyfosUserId,
    plan: lyfosPlan,
    status: "active",
    provider: "razorpay",
    razorpay_subscription_id: null,
    razorpay_customer_id: null,
    current_period_start: new Date().toISOString(),
    current_period_end: null, // one-time lifetime purchase — nothing to renew
    cancel_at_period_end: false,
    cancelled_at: null,
    grace_until: null
  }, { onConflict: "user_id" });

  const { data: inserted } = await admin.from("billing_events").insert({
    user_id: lyfosUserId,
    provider: "razorpay",
    event_type: "payment.captured",
    provider_event_id: eventId,
    provider_payment_id: pay?.id ?? null,
    amount_paise: pay?.amount ?? link?.amount ?? null,
    currency: pay?.currency ?? "INR",
    payload: scrub(body)
  }).select("id").single();

  // Fire-and-forget invoice generation. The function is idempotent.
  if (inserted?.id) {
    fetch(`${SUPABASE_URL}/functions/v1/generate-invoice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ event_id: inserted.id })
    }).catch((err) => console.warn("[lyfos] invoice gen kick failed", err?.message));
  }
}

async function handlePaymentFailed(body: any, eventId: string) {
  const pay = body?.payload?.payment?.entity;
  const lyfosUserId =
    body?.payload?.payment_link?.entity?.notes?.lyfos_user_id ?? null;
  await admin.from("billing_events").insert({
    user_id: lyfosUserId,
    provider: "razorpay",
    event_type: "payment.failed",
    provider_event_id: eventId,
    provider_payment_id: pay?.id ?? null,
    amount_paise: pay?.amount ?? null,
    currency: pay?.currency ?? "INR",
    payload: scrub(body)
  });
}

// ============================================================
// helpers
// ============================================================

async function verifyHmacSha256(secret: string, payload: string, expectedHex: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare
  if (hex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

async function logEvent(userId: string | null, eventType: string, body: any, eventId: string, paymentId: string | null) {
  await admin.from("billing_events").insert({
    user_id: userId,
    provider: "razorpay",
    event_type: eventType,
    provider_event_id: eventId,
    provider_payment_id: paymentId,
    payload: scrub(body)
  });
}

function scrub(body: any) {
  // Remove anything that even smells like card data before storing.
  // Razorpay shouldn't send raw PAN but be paranoid.
  try {
    const json = JSON.parse(JSON.stringify(body));
    if (json?.payload?.payment?.entity?.card) {
      delete json.payload.payment.entity.card.number;
      delete json.payload.payment.entity.card.cvv;
    }
    return json;
  } catch {
    return null;
  }
}

function text(s: string, status = 200) {
  return new Response(s, { status, headers: { "content-type": "text/plain" } });
}
